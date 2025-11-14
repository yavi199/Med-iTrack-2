
'use server';

import 'dotenv/config';
import { extractOrderData } from "@/ai/flows/extract-order-flow";
import { extractReportText as extractReportTextFlow } from "@/ai/flows/extract-report-text-flow";
import { generateSilenceRequestAudio as generateSilenceRequestAudioFlow, generateTurnCallAudio as generateTurnCallAudioFlow } from "@/ai/flows/tts-flow";
import { transcribeAudio as transcribeAudioFlow, type TranscribeInput } from "@/ai/flows/stt-flow";
import { db, storage } from "@/lib/firebase";
import type { Study, UserProfile, OrderData, StudyStatus, GeneralService, SubServiceArea, OperationalStatus, StudyWithCompletedBy, Message, ContrastType, InventoryItem, InventoryCategory, OperationalExpense, ConsumedItem, Specialist, InventoryStockEntry, InventoryConsumption, RemissionStatus, Remission } from '@/lib/types';
import { addDoc, collection, doc, serverTimestamp, updateDoc, setDoc, deleteDoc, deleteField, getDocs, query, where, Timestamp, getDoc, arrayUnion, arrayRemove, orderBy, runTransaction, increment, writeBatch, or, limit } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { z } from "zod";
import { GeneralServices, InventoryCategories, Modalities } from "@/lib/types";
import { format, differenceInYears, startOfDay, endOfDay, subHours, parse } from 'date-fns';
import { getAuth, sendPasswordResetEmail as firebaseSendPasswordResetEmail, signInWithCustomToken } from "firebase/auth";
// import admin from 'firebase-admin';
import { firebaseConfig } from '@/lib/firebaseConfig';
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { appendOrderToSheet, appendOrUpdateRemissionSheet } from '@/services/google-sheets';
import { exportStudiesToExcel } from '@/services/excel-export';
import { sendWhatsAppMessage } from '@/services/twilio';

/*
// TEMPORARILY DISABLED TO PREVENT SERVER CRASH ON DEPLOYMENT
// This requires environment variables to be set in the deployment environment.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseConfig.projectId,
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: firebaseConfig.storageBucket,
  });
}
*/


export async function extractStudyDataAction(input: { medicalOrderDataUri: string }) {
    try {
        const result = await extractOrderData(input);
        return { success: true, data: result };
    } catch(error: any) {
        console.error("AI extraction error:", error);
        return { success: false, error: error.message || "Failed to extract data from the document." };
    }
}


const getAgeFromBirthDate = (birthDateString?: string): number | null => {
    if (!birthDateString) return null;
    try {
        const dateParts = birthDateString.split(/[-/]/);
        if (dateParts.length !== 3) return null;
        
        let day, month, year;
        
        if (dateParts[0].length === 4) { // YYYY-MM-DD
            year = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            day = parseInt(dateParts[2], 10);
        } else if (dateParts[2].length === 4) { // DD/MM/YYYY or MM/DD/YYYY
            day = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            year = parseInt(dateParts[2], 10);
        } else {
            return null; // Unsupported format
        }

        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

        // Simple heuristic to differentiate DD/MM from MM/DD
        if (month > 11) {
             [day, month] = [month+1, day-1];
        }

        const birthDate = new Date(year, month, day);
        if (isNaN(birthDate.getTime())) return null;

        return differenceInYears(new Date(), birthDate);
    } catch { 
        return null; 
    }
}

type CreateStudyOptions = {
    creatinine?: number;
    service?: GeneralService;
    subService?: SubServiceArea;
    skipDuplicateCheck?: boolean;
};

export async function createStudyAction(
    data: OrderData, 
    userProfile: UserProfile | null,
    options: CreateStudyOptions = {}
) {
    if (!userProfile) {
        return { success: false, error: "User profile not available." };
    }

    try {
        const studiesToCreate = data.studies;

        if (studiesToCreate.length === 0) {
            return { success: false, error: "No se encontraron estudios o consultas en la orden." };
        }
        
        if (!options.skipDuplicateCheck && studiesToCreate.length > 0) {
            const firstStudy = studiesToCreate[0];
            const twentyFourHoursAgo = Timestamp.fromDate(subHours(new Date(), 24));

            const q = query(
                collection(db, "studies"),
                where("patient.id", "==", data.patient.id),
                where("studies.0.nombre", "==", firstStudy.nombre),
                where("requestDate", ">=", twentyFourHoursAgo)
            );

            const duplicateSnapshot = await getDocs(q);
            if (!duplicateSnapshot.empty) {
                return { 
                    success: false, 
                    requiresConfirmation: true,
                    duplicateStudyName: firstStudy.nombre,
                    error: `Ya existe un estudio de '${firstStudy.nombre}' para este paciente creado en las últimas 24 horas.`
                };
            }
        }

        let service: Study['service'];
        let subService: Study['subService'];

        if (options.service && options.subService) {
            service = options.service;
            subService = options.subService;
        } else if (GeneralServices.includes(userProfile.servicioAsignado as any)) {
            service = userProfile.servicioAsignado as Study['service'];
            subService = userProfile.subServicioAsignado || "AMB";
        } else {
            service = "C.EXT";
            subService = "AMB";
        }
        
        const batch = writeBatch(db);

        for (const singleStudy of studiesToCreate) {
            const newStudyRef = doc(collection(db, "studies"));
            
            const studyData: Partial<Study> & {patient: OrderData['patient']} = {
                patient: {
                    ...data.patient,
                    idType: data.patient.idType,
                },
                diagnosis: data.diagnosis,
                studies: [singleStudy], 
                service,
                subService,
                status: "Pendiente",
                requestDate: serverTimestamp() as Timestamp,
                admissionNumber: data.admissionNumber || 'INGRESO MANUAL',
                referenceNumber: data.referenceNumber || null,
            };

            if (data.orderDate) {
                try {
                    const parsedDate = parse(data.orderDate, 'dd/MM/yyyy', new Date());
                    if (!isNaN(parsedDate.getTime())) {
                        studyData.orderDate = Timestamp.fromDate(parsedDate);
                    }
                } catch (e) {
                    console.warn(`Could not parse orderDate: ${data.orderDate}`);
                }
            }

            if (data.orderingPhysician) {
                studyData.orderingPhysician = data.orderingPhysician;
            }
            
            if (data.requiresCreatinine && options.creatinine) {
                studyData.contrastType = 'IV';
                studyData.creatinine = options.creatinine;
                const age = getAgeFromBirthDate(data.patient.birthDate);
                studyData.contrastBilledMl = (age !== null && age < 10) ? 50 : 100;
            }

            batch.set(newStudyRef, studyData);
        }
        
        await batch.commit();
        
        return { success: true, studyCount: studiesToCreate.length };
    } catch (error: any) {
        console.error("Failed to create study:", error);
        return { success: false, error: `Failed to create study: ${error.message}` };
    }
}


export async function updateStudyAction(studyId: string, data: OrderData) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        
        if (!Array.isArray(data.studies) || data.studies.length !== 1) {
            return { success: false, error: "El formato de los estudios es inválido. Solo se puede editar un estudio a la vez." };
        }

        const updateData:Partial<Study> & {patient: OrderData['patient']} = {
            patient: data.patient,
            diagnosis: data.diagnosis,
            studies: data.studies,
        };

        await updateDoc(studyRef, updateData);
        return { success: true };
    } catch (error: any) {
        console.error("Failed to update study:", error);
        return { success: false, error: `Failed to update study: ${error.message}` };
    }
}

export async function updateStudyStatusAction(
    studyId: string, 
    status: Study['status'], 
    userProfile: UserProfile | null, 
    params?: { 
        kV?: number; 
        mA?: number; 
        timeMs?: number; 
        ctdi?: number;
        dlp?: number;
        consumedItems?: ConsumedItem[];
        contrastAdministeredMl?: number;
    }, 
    completedByOperator?: string,
    cancellationReason?: string
) {
    if (!userProfile) {
        return { success: false, error: "User profile not available." };
    }

    const studyRef = doc(db, 'studies', studyId);
    console.log("[ACTION LOG] updateStudyStatusAction called for study", studyId, "to status", status);

    try {
        await runTransaction(db, async (transaction) => {
            const studyDoc = await transaction.get(studyRef);
            if (!studyDoc.exists()) {
                throw new Error("El estudio no existe.");
            }
            const studyData = studyDoc.data() as Study;

            const updateData: Partial<StudyWithCompletedBy> & { [key: string]: any } = { status };
            
            if (status === 'Completado') {
                updateData.completionDate = serverTimestamp();
                updateData.readingDate = deleteField();
                updateData.cancellationReason = deleteField();

                if (completedByOperator) {
                    updateData.completedBy = completedByOperator;
                } else if (userProfile.rol === 'tecnologo' || userProfile.rol === 'transcriptora') {
                    const userDoc = await transaction.get(doc(db, 'users', userProfile.uid));
                    const userData = userDoc.data() as UserProfile | undefined;
                    if (userData?.operadorActivo) {
                        updateData.completedBy = userData.operadorActivo;
                    } else {
                        updateData.completedBy = userProfile.nombre; // Fallback
                    }
                } else if (userProfile.rol === 'administrador') {
                    updateData.completedBy = "Francisco Vergara";
                }

                if (params) {
                    if(params.kV) updateData.kV = params.kV;
                    if(params.mA) updateData.mA = params.mA;
                    if(params.timeMs) updateData.timeMs = params.timeMs;
                    if(params.ctdi) updateData.ctdi = params.ctdi;
                    if(params.dlp) updateData.dlp = params.dlp;

                    if (params.contrastAdministeredMl !== undefined) {
                        updateData.contrastAdministeredMl = params.contrastAdministeredMl;
                        updateData.contrastRemainingMl = (studyData.contrastBilledMl || 0) - params.contrastAdministeredMl;
                    }
                }
                updateData.consumedSupplies = params?.consumedItems || [];

                if (params?.consumedItems && params.consumedItems.length > 0) {
                    for (const item of params.consumedItems) {
                        if (item.id && item.amount > 0) {
                            const newConsumptionRef = doc(collection(db, "inventoryConsumptions"));
                            const consumptionData: Omit<InventoryConsumption, 'id'> = {
                                studyId: studyId,
                                itemId: item.id,
                                itemName: item.name,
                                amountConsumed: item.amount,
                                consumedBy: {
                                    uid: userProfile.uid,
                                    name: userProfile.nombre,
                                },
                                date: serverTimestamp() as Timestamp,
                            };
                            transaction.set(newConsumptionRef, consumptionData);
                        }
                    }
                }
            } else if (status === 'Leído') {
                updateData.readingDate = serverTimestamp();
            } else if (status === 'Cancelado') {
                updateData.cancellationReason = cancellationReason || 'No especificado';
                updateData.completionDate = deleteField();
                updateData.readingDate = deleteField();
                updateData.completedBy = deleteField();
                updateData.consumedSupplies = deleteField();
            }

            if ((userProfile.rol === 'administrador' || userProfile.rol === 'tecnologo') && status === 'Pendiente') {
                updateData.completionDate = deleteField();
                updateData.readingDate = deleteField();
                updateData.kV = deleteField();
                updateData.mA = deleteField();
                updateData.timeMs = deleteField();
                updateData.ctdi = deleteField();
                updateData.dlp = deleteField();
                updateData.completedBy = deleteField();
                updateData.cancellationReason = deleteField();
                updateData.contrastType = deleteField();
                updateData.creatinine = deleteField();
                updateData.consumedSupplies = deleteField();
            }

            transaction.update(studyRef, updateData);
        });

        if (status === 'Completado') {
            const finalStudyDoc = await getDoc(studyRef);
            if (finalStudyDoc.exists()) {
                const finalStudyData = { id: finalStudyDoc.id, ...finalStudyDoc.data() } as Study;
                const sanitizedStudyData = {
                    ...finalStudyData,
                    requestDate: finalStudyData.requestDate?.toDate(),
                    completionDate: finalStudyData.completionDate ? finalStudyData.completionDate.toDate() : new Date(),
                    readingDate: finalStudyData.readingDate?.toDate(),
                    orderDate: finalStudyData.orderDate?.toDate(),
                };
                
                console.log("[ACTION LOG] Calling appendOrderToSheet...");
                appendOrderToSheet(sanitizedStudyData).catch(error => {
                    console.error("[ACTION LOG] Error in fire-and-forget appendOrderToSheet:", error);
                });
            }
        }

        return { success: true };
    } catch(error) {
        console.error("Error updating study status:", error);
        return { success: false, error: "Failed to update study status." };
    }
}

export async function updateStudyServiceAction(studyId: string, service: GeneralService, subService: SubServiceArea) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        await updateDoc(studyRef, {
            service,
            subService,
        });
        return { success: true };
    } catch(error: any) {
        console.error("Error updating study service:", error);
        return { success: false, error: "Fallo al actualizar el servicio del estudio." };
    }
}

export async function updateStudyTurnNumberAction(studyId: string, turnNumber: string) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        await updateDoc(studyRef, {
            turnNumber,
        });
        return { success: true };
    } catch(error: any) {
        console.error("Error updating turn number:", error);
        return { success: false, error: "Fallo al actualizar el número de turno." };
    }
}

export async function updateStudyBedNumberAction(studyId: string, bedNumber: string) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        await updateDoc(studyRef, {
            bedNumber,
        });
        return { success: true };
    } catch(error: any) {
        console.error("Error updating bed number:", error);
        return { success: false, error: "Fallo al actualizar el número de cama." };
    }
}


export async function setStudyContrastAction(
    studyId: string, 
    contrastType: ContrastType | null, 
    params?: { 
        creatinine?: number,
    }
) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        
        if (contrastType === null) {
            await updateDoc(studyRef, {
                contrastType: deleteField(),
                creatinine: deleteField(),
                contrastBilledMl: deleteField(),
                contrastAdministeredMl: deleteField(),
                contrastRemainingMl: deleteField(),
            });
        } else {
            const studyDoc = await getDoc(studyRef);
            if (!studyDoc.exists()) {
                 return { success: false, error: "El estudio no existe." };
            }
            const studyData = studyDoc.data() as Study;

            const updateData: { [key: string]: any } = { contrastType };

            if (contrastType === 'IV') {
                const age = getAgeFromBirthDate(studyData.patient.birthDate);
                const billedMl = (age !== null && age < 10) ? 50 : 100;
                updateData.contrastBilledMl = billedMl;
                
                if (params?.creatinine) updateData.creatinine = params.creatinine;

            } else if (contrastType === 'Bario') {
                updateData.creatinine = deleteField();
                updateData.contrastBilledMl = deleteField();
                updateData.contrastAdministeredMl = deleteField();
                updateData.contrastRemainingMl = deleteField();
            }
            await updateDoc(studyRef, updateData);
        }
        return { success: true };
    } catch (error: any) {
        console.error("Error updating contrast status:", error);
        return { success: false, error: `Fallo al cambiar el estado de contraste: ${error.message}` };
    }
}


export async function cancelStudyAction(studyId: string, reason: string, userProfile: UserProfile | null) {
    return updateStudyStatusAction(studyId, 'Cancelado', userProfile, undefined, undefined, reason);
}

export async function deleteStudyAction(studyId: string) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        await deleteDoc(studyRef);
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting study:", error);
        return { success: false, error: "Failed to delete study." };
    }
}

export async function extractReportTextAction(reportDataUri: string) {
    try {
        const { reportText } = await extractReportTextFlow({ reportDataUri });
        return { success: true, text: reportText };
    } catch (error: any) {
        console.error("Error extracting report text:", error);
        return { success: false, error: `Error al extraer texto: ${error.message}` };
    }
}

export async function saveReportDataAction(studyId: string, reportUrl: string | undefined, reportText: string) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        
        await updateDoc(studyRef, {
            reportUrl: reportUrl || deleteField(),
            reportText: reportText, 
            status: 'Leído',
            readingDate: serverTimestamp(),
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error saving report data:", error);
        return { success: false, error: `Error al guardar el informe: ${error.message}` };
    }
}


const signupSchema = z.object({
  nombre: z.string(),
  email: z.string().email(),
  password: z.string(),
  rol: z.string(),
  servicioAsignado: z.string(),
  subServicioAsignado: z.string().optional(),
});

export async function signupUserAction(data: z.infer<typeof signupSchema>) {
    // This function requires Firebase Admin to be initialized, which is temporarily disabled.
    // if (!admin.apps.length) {
        console.error("Firebase Admin SDK is not initialized. Cannot create user.");
        return { success: false, error: "La creación de usuarios está temporalmente deshabilitada. Contacte al soporte." };
    // }
    /*
    try {
        const userRecord = await admin.auth().createUser({
            email: data.email,
            password: data.password,
            displayName: data.nombre,
        });

        const userProfile: Omit<UserProfile, 'uid'> = {
            nombre: data.nombre,
            email: data.email,
            rol: data.rol as UserProfile['rol'],
            servicioAsignado: data.servicioAsignado as UserProfile['servicioAsignado'],
            subServicioAsignado: data.subServicioAsignado as UserProfile['subServicioAsignado'],
            activo: true,
            operationalStatus: data.rol === 'tecnologo' || data.rol === 'transcriptora' ? 'Disponible' : 'No Disponible',
            operadores: [],
            operadorActivo: null,
            activeSurgerySessionId: null,
        };

        await setDoc(doc(db, "users", userRecord.uid), userProfile);
        
        return { success: true, userId: userRecord.uid };
    } catch (error: any) {
        console.error("Signup error:", error);
        let errorMessage = "Ocurrió un error inesperado.";
        if (error.code === 'auth/email-already-exists') {
            errorMessage = "Este correo electrónico ya está en uso.";
        }
        return { success: false, error: errorMessage };
    }
    */
}

export async function updateUserOperationalStatusAction(userId: string, newStatus: OperationalStatus) {
    try {
        await runTransaction(db, async (transaction) => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await transaction.get(userRef);

            if (!userSnap.exists()) {
                throw new Error("Usuario no encontrado");
            }
            const currentUserData = userSnap.data() as UserProfile;
            const oldStatus = currentUserData.operationalStatus;

            if (currentUserData.rol === 'tecnologo' && currentUserData.servicioAsignado === 'RX') {
                if (newStatus === 'En Cirugía') {
                    const historyRef = doc(collection(db, 'operationalStatusHistory'));
                    transaction.set(historyRef, {
                        userId: userId,
                        userName: currentUserData.nombre,
                        startTime: serverTimestamp(),
                        endTime: null,
                        durationMinutes: null,
                        status: 'En Cirugía'
                    });
                    transaction.update(userRef, { 
                        operationalStatus: newStatus,
                        activeSurgerySessionId: historyRef.id
                    });
                } else if (oldStatus === 'En Cirugía' && newStatus === 'Disponible') {
                    const activeSessionId = currentUserData.activeSurgerySessionId;
                    if (activeSessionId) {
                        const historyDocRef = doc(db, 'operationalStatusHistory', activeSessionId);
                        const historyDocSnap = await transaction.get(historyDocRef);

                        if (historyDocSnap.exists()) {
                            const entryData = historyDocSnap.data();
                            const startTime = (entryData.startTime as Timestamp).toDate();
                            const endTime = new Date();
                            const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);

                            transaction.update(historyDocRef, {
                                endTime: Timestamp.fromDate(endTime),
                                durationMinutes: Math.round(durationMinutes)
                            });
                        }
                    }
                    transaction.update(userRef, { 
                        operationalStatus: newStatus,
                        activeSurgerySessionId: null
                    });
                } else {
                    transaction.update(userRef, { operationalStatus: newStatus });
                }
            } else {
                 transaction.update(userRef, { operationalStatus: newStatus });
            }
        });

        return { success: true };
    } catch(error: any) {
        console.error("Error updating operational status:", error);
        return { success: false, error: `Failed to update operational status: ${error.message}` };
    }
}


export async function setActiveOperatorAction(userId: string, operatorName: string) {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            operadorActivo: operatorName,
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error setting active operator:", error);
        return { success: false, error: `Failed to set active operator: ${error.message}` };
    }
}

export async function exportStudiesAction(input: any) {
    try {
        const fileBuffer = await exportStudiesToExcel(input);
        return { success: true, fileBuffer };
    } catch (error: any) {
        console.error("Error exporting studies:", error);
        return { success: false, error: "Ocurrió un error al exportar los datos." };
    }
}


export async function addOperatorAction(userId: string, operatorName: string) {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            operadores: arrayUnion(operatorName)
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error adding operator:", error);
        return { success: false, error: `Failed to add operator: ${error.message}` };
    }
}

export async function removeOperatorAction(userId: string, operatorName: string) {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            operadores: arrayRemove(operatorName)
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error removing operator:", error);
        return { success: false, error: `Failed to remove operator: ${error.message}` };
    }
}

export async function toggleUserStatusAction(userId: string, currentStatus: boolean) {
    try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            activo: !currentStatus
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error toggling user status:", error);
        return { success: false, error: `Failed to toggle user status: ${error.message}` };
    }
}


export async function sendMessageAction(sender: UserProfile, recipientRole: 'tecnologo' | 'transcriptora', content: string) {
    if (!content.trim()) {
        return { success: false, error: "El mensaje no puede estar vacío." };
    }
    try {
        const messageData: Omit<Message, 'id'> = {
            senderId: sender.uid,
            senderName: sender.nombre,
            recipientRole,
            content,
            createdAt: serverTimestamp() as Timestamp,
            read: false,
        };
        await addDoc(collection(db, "messages"), messageData);
        return { success: true };
    } catch (error: any) {
        console.error("Error sending message:", error);
        return { success: false, error: `Error al enviar mensaje: ${error.message}` };
    }
}

export async function markMessagesAsReadAction(messageIds: string[]) {
    try {
        const batch = writeBatch(db);
        for (const id of messageIds) {
            const messageRef = doc(db, 'messages', id);
            batch.update(messageRef, { read: true });
        }
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error marking messages as read:", error);
        return { success: false, error: `Error al marcar mensajes como leídos: ${error.message}` };
    }
}


export async function getRadiologistOperatorsAction(): Promise<string[]> {
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("rol", "==", "transcriptora"));
        const querySnapshot = await getDocs(q);
        
        const allOperators = new Set<string>();
        querySnapshot.forEach((doc) => {
            const user = doc.data() as UserProfile;
            if (user.operadores && user.operadores.length > 0) {
                user.operadores.forEach(op => allOperators.add(op));
            }
        });
        
        return Array.from(allOperators);
    } catch (error) {
        console.error("Error fetching radiologist operators:", error);
        return [];
    }
}

export async function getInventoryItemsAction(itemNames: string[]): Promise<InventoryItem[]> {
    if (itemNames.length === 0) return [];
    try {
        const itemsToQuery = [...itemNames];
        const contrastQuery = query(collection(db, "inventoryItems"), where("isContrast", "==", true));
        const [snapshotByFlag] = await Promise.all([getDocs(contrastQuery)]);

        const itemsMap = new Map<string, InventoryItem>();
        
        snapshotByFlag.forEach(doc => {
             if (!itemsMap.has(doc.id)) {
                itemsMap.set(doc.id, { id: doc.id, ...doc.data() } as InventoryItem);
            }
        });

        const remainingNames = itemsToQuery.filter(name => ![...itemsMap.values()].some(item => item.name === name));
        
        if (remainingNames.length > 0) {
            const qByName = query(collection(db, "inventoryItems"), where("name", "in", remainingNames));
            const snapshotByName = await getDocs(qByName);
            snapshotByName.forEach(doc => {
                itemsMap.set(doc.id, { id: doc.id, ...doc.data() } as InventoryItem);
            });
        }

        return Array.from(itemsMap.values());
    } catch (error) {
        console.error("Error fetching inventory items:", error);
        return [];
    }
}

const newItemSchema = z.object({
    name: z.string().min(3),
    category: z.enum(InventoryCategories),
    presentation: z.enum(['Caja', 'Frasco', 'Unidad']),
    content: z.number().min(1),
    contentUnit: z.enum(['unidades', 'ml', 'g']),
    specification: z.string().optional(),
    stock: z.number().min(0),
    price: z.number().optional(),
});

export async function createInventoryItemAction(data: z.infer<typeof newItemSchema>): Promise<{ success: boolean, error?: string }> {
    try {
        const newItemRef = doc(collection(db, "inventoryItems"));

        const itemData: Omit<InventoryItem, 'id'> = {
            name: data.name,
            category: data.category as InventoryCategory,
            presentation: data.presentation,
            content: data.content,
            contentUnit: data.contentUnit,
            specification: data.specification,
            stock: 0, 
            price: data.price,
            isContrast: data.category === 'contraste',
        };
        await setDoc(newItemRef, itemData);
        return { success: true };
    } catch (error: any) {
        console.error("Error creating inventory item:", error);
        return { success: false, error: "No se pudo crear el nuevo insumo." };
    }
}

export async function updateInventoryItemPriceAction(itemId: string, price: number): Promise<{ success: boolean, error?: string }> {
    try {
        const itemRef = doc(db, "inventoryItems", itemId);
        await updateDoc(itemRef, {
            price: price
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error updating item price:", error);
        return { success: false, error: "No se pudo actualizar el precio del insumo." };
    }
}

const addOperationalExpenseSchema = z.object({
    category: z.enum(['Sueldos', 'Servicios', 'Arriendo', 'Insumos', 'Otro']),
    description: z.string().min(3),
    amount: z.number().min(1),
});

export async function addOperationalExpenseAction(data: z.infer<typeof addOperationalExpenseSchema>): Promise<{ success: boolean, error?: string }> {
    try {
        const newExpenseRef = doc(collection(db, "operationalExpenses"));

        const expenseData: Omit<OperationalExpense, 'id'> = {
            ...data,
            date: serverTimestamp() as Timestamp,
        };
        await setDoc(newExpenseRef, expenseData);
        return { success: true };
    } catch (error: any) {
        console.error("Error creating operational expense:", error);
        return { success: false, error: "No se pudo registrar el gasto." };
    }
}

const updateOperationalExpenseSchema = addOperationalExpenseSchema.extend({
    id: z.string(),
});

export async function updateOperationalExpenseAction(data: z.infer<typeof updateOperationalExpenseSchema>): Promise<{ success: boolean, error?: string }> {
    try {
        const expenseRef = doc(db, "operationalExpenses", data.id);
        await updateDoc(expenseRef, {
            category: data.category,
            description: data.description,
            amount: data.amount,
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error updating operational expense:", error);
        return { success: false, error: "No se pudo actualizar el gasto." };
    }
}

export async function deleteOperationalExpenseAction(id: string): Promise<{ success: boolean, error?: string }> {
    try {
        const expenseRef = doc(db, "operationalExpenses", id);
        await deleteDoc(expenseRef);
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting operational expense:", error);
        return { success: false, error: "No se pudo eliminar el gasto." };
    }
}

export async function resetContrastStockAction(): Promise<{ success: boolean; error?: string }> {
    try {
        const q = query(collection(db, "inventoryItems"), where("isContrast", "==", true));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return { success: false, error: "No se encontró ningún item de contraste para reiniciar." };
        }

        const batch = writeBatch(db);
        querySnapshot.forEach(docSnap => {
            batch.update(docSnap.ref, { stock: 0 });
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Error resetting contrast stock:', error);
        return { success: false, error: 'Failed to reset contrast stock.' };
    }
}

export type GeneralAlarm = {
    id: string;
    triggeredBy: {
        uid: string;
        name: string;
        rol: UserProfile['rol']
    },
    createdAt: Timestamp;
}
export async function sendGeneralAlarmAction(user: UserProfile) {
    if(!user) return { success: false, error: "Usuario no autenticado." };

    try {
        const alarmData = {
             triggeredBy: {
                uid: user.uid,
                name: user.nombre,
                rol: user.rol,
            },
            createdAt: serverTimestamp()
        };
        await addDoc(collection(db, "generalAlarms"), alarmData);
        return { success: true };
    } catch (error: any) {
        console.error("Error sending general alarm:", error);
        return { success: false, error: "No se pudo enviar la alarma general." };
    }
}


export async function clearCtdiDataAction(): Promise<{ success: boolean, error?: string, count?: number }> {
    try {
        const studiesCollection = collection(db, 'studies');
        const snapshot = await getDocs(studiesCollection);

        if (snapshot.empty) {
            return { success: true, count: 0 };
        }

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { dlp: deleteField() });
        });

        await batch.commit();
        return { success: true, count: snapshot.size };
    } catch (error: any) {
        console.error("Error clearing ctdivol data:", error);
        return { success: false, error: "No se pudieron limpiar los datos de CTDIvol." };
    }
}


export async function sendPasswordResetEmailAction(email: string) {
    try {
        // This function requires Firebase Admin to be initialized, which is temporarily disabled.
        // if (!admin.apps.length) {
            console.error("Firebase Admin SDK is not initialized. Cannot send password reset email.");
            return { success: false, error: "El envío de correos está temporalmente deshabilitado. Contacte al soporte." };
        // }
        // In a real scenario, you'd generate a link and use a mail service.
        // For this example, we simulate success.
        // const link = await admin.auth().generatePasswordResetLink(email);
        // await sendEmailWithLink(email, link); // Fictional email function
        
        console.log(`Simulating password reset email sent to ${email}`);
        return { success: true };
    } catch (error: any) {
        console.error("Password reset error:", error);
        return { success: false, error: "No se pudo enviar el correo de restablecimiento." };
    }
}

const serializeDates = (obj: any): any => {
    if (!obj) return obj;
    if (obj instanceof Timestamp) {
        return obj.toDate().toISOString();
    }
    if (Array.isArray(obj)) {
        return obj.map(item => serializeDates(item));
    }
    if (typeof obj === 'object') {
        const newObj: { [key: string]: any } = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                newObj[key] = serializeDates(obj[key]);
            }
        }
        return newObj;
    }
    return obj;
};

export async function generateReportFromTemplateAction(studyId: string) {
    try {
        const studyRef = doc(db, 'studies', studyId);
        const studySnap = await getDoc(studyRef);

        if (!studySnap.exists()) {
            return { success: false, error: "Estudio no encontrado." };
        }

        const studyData = { id: studySnap.id, ...studySnap.data() } as StudyWithCompletedBy;
        
        let radiologist = { name: 'Radiólogo No Asignado', specialty: 'Médico Radiólogo', register: '' };
        if (studyData.completedBy) {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("operadores", "array-contains", studyData.completedBy), where("rol", "==", "transcriptora"), limit(1));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                const radiologistProfile = querySnapshot.docs[0].data() as UserProfile;
                radiologist = {
                    name: radiologistProfile.nombre || studyData.completedBy,
                    specialty: 'Médico Radiólogo',
                    register: radiologistProfile.servicioAsignado || '' 
                };
            } else {
                radiologist.name = studyData.completedBy;
            }
        }

        let reportText = studyData.reportText || "No se encontró texto de informe para este estudio.";
        
        if (studyData.reportUrl && !studyData.reportText) {
             try {
                const response = await fetch(studyData.reportUrl);
                if (response.ok) {
                    reportText = await response.text();
                } else {
                    reportText = `No se pudo cargar el contenido del informe desde la URL. Puede intentar abrirlo manualmente: ${studyData.reportUrl}`;
                }
            } catch (e) {
                reportText = `Error al cargar el contenido del informe.`;
            }
        }

        const serializedStudy = serializeDates(studyData);
        
        return {
            success: true,
            data: {
                study: serializedStudy,
                reportText: reportText,
                radiologist: radiologist,
            },
        };
    } catch (error: any) {
        console.error("Error in generateReportFromTemplateAction:", error);
        return { success: false, error: error.message || "Error desconocido al generar el informe." };
    }
}


export async function searchStudiesAction(searchTerm: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    if (!searchTerm || searchTerm.trim() === '') {
        return { success: false, error: "El término de búsqueda no puede estar vacío." };
    }

    try {
        const studiesRef = collection(db, 'studies');
        
        const nameQuery = query(
            studiesRef,
            where('patient.fullName', '>=', searchTerm.toUpperCase()),
            where('patient.fullName', '<=', searchTerm.toUpperCase() + '\uf8ff')
        );

        const idQuery = query(
            studiesRef,
            where('patient.id', '==', searchTerm)
        );

        const [nameSnapshot, idSnapshot] = await Promise.all([
            getDocs(nameQuery),
            getDocs(idQuery),
        ]);

        const studiesMap = new Map<string, Study>();

        nameSnapshot.forEach(doc => {
            studiesMap.set(doc.id, { id: doc.id, ...doc.data() } as Study);
        });

        idSnapshot.forEach(doc => {
            studiesMap.set(doc.id, { id: doc.id, ...doc.data() } as Study);
        });

        let combinedStudies = Array.from(studiesMap.values());
        combinedStudies.sort((a, b) => b.requestDate.toMillis() - a.requestDate.toMillis());
        
        const serializedStudies = combinedStudies.map(study => serializeDates({ ...study }));

        return { success: true, data: serializedStudies };
    } catch (error) {
        console.error("Error searching studies:", error);
        return { success: false, error: "No se pudieron buscar los estudios." };
    }
}

const addMultipleInventoryEntriesSchema = z.object({
  entries: z.array(z.object({
    itemId: z.string(),
    itemName: z.string(),
    presentation: z.string(),
    service: z.enum(['RX', 'TAC', 'ECO', 'General']),
    quantity: z.number().min(1),
    lote: z.string().optional(),
    price: z.number().optional(),
  })),
  userProfile: z.custom<UserProfile>(),
});

export async function addMultipleInventoryEntriesAction(data: z.infer<typeof addMultipleInventoryEntriesSchema>): Promise<{ success: boolean; error?: string }> {
  const { entries, userProfile } = data;
  if (!userProfile) {
    return { success: false, error: 'Usuario no autenticado.' };
  }

  const batch = writeBatch(db);

  try {
    for (const entry of entries) {
      const newEntryRef = doc(collection(db, 'inventoryEntries'));

      const newEntry: Omit<InventoryStockEntry, 'id'> = {
        itemId: entry.itemId,
        itemName: entry.itemName,
        presentation: entry.presentation,
        service: entry.service,
        amountAdded: entry.quantity,
        date: serverTimestamp() as Timestamp,
        addedBy: {
          uid: userProfile.uid,
          name: userProfile.nombre,
        },
        lote: entry.lote,
        priceAtEntry: entry.price || 0,
      };
      batch.set(newEntryRef, newEntry);
    }

    await batch.commit();
    return { success: true };
  } catch (error: any) {
    console.error('Error adding multiple inventory entries:', error);
    return { success: false, error: 'No se pudieron registrar las entradas de insumos.' };
  }
}

export async function generateSilenceRequestAudioAction(): Promise<{ success: boolean, audioDataUri?: string, error?: string }> {
    try {
        const result = await generateSilenceRequestAudioFlow();
        return { success: true, audioDataUri: result.audioDataUri };
    } catch (error: any) {
        console.error("Error generating silence request audio:", error);
        return { success: false, error: `No se pudo generar el audio: ${error.message}` };
    }
}

export async function generateTurnCallAudioAction(turnDisplay: string, modalityName: string): Promise<{ success: boolean, audioDataUri?: string, error?: string }> {
    try {
        const result = await generateTurnCallAudioFlow({ turnDisplay, modalityName });
        return { success: true, audioDataUri: result.audioDataUri };
    } catch (error: any) {
        console.error("Error generating turn call audio:", error);
        return { success: false, error: `No se pudo generar el audio de llamado: ${error.message}` };
    }
}

export async function callPatientAction(studyId: string, modality: 'ECO' | 'RX' | 'TAC'): Promise<{ success: boolean, error?: string }> {
    try {
        const turneroRef = doc(db, 'turnero', modality);
        await setDoc(turneroRef, { 
            lastCalledStudyId: studyId,
            calledAt: serverTimestamp(),
        }, { merge: true });
        return { success: true };
    } catch (error: any) {
        console.error("Error calling patient:", error);
        return { success: false, error: "No se pudo realizar el llamado del paciente." };
    }
}

export async function uploadDicomFileAction(base64Dicom: string): Promise<{ success: boolean; error?: string }> {
    console.warn("DICOM upload functionality is disabled.");
    return { success: false, error: "La funcionalidad de carga DICOM ha sido deshabilitada." };
}

const specialistSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3),
  specialty: z.string().min(1),
  phoneNumber: z.string().min(10),
});

export async function addSpecialistAction(data: Omit<z.infer<typeof specialistSchema>, 'id'>): Promise<{ success: boolean, error?: string }> {
    try {
        await addDoc(collection(db, "specialists"), data);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: "No se pudo crear el especialista." };
    }
}

export async function updateSpecialistAction(data: z.infer<typeof specialistSchema>): Promise<{ success: boolean, error?: string }> {
    if (!data.id) return { success: false, error: "ID del especialista es requerido." };
    try {
        const { id, ...specialistData } = data;
        await updateDoc(doc(db, "specialists", id), specialistData);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: "No se pudo actualizar el especialista." };
    }
}

export async function deleteSpecialistAction(id: string): Promise<{ success: boolean, error?: string }> {
    try {
        await deleteDoc(doc(db, "specialists", id));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: "No se pudo eliminar el especialista." };
    }
}

export async function transcribeAudioAction(input: TranscribeInput): Promise<{ success: boolean, text?: string, error?: string }> {
    try {
        const result = await transcribeAudioFlow(input);
        return { success: true, text: result.text };
    } catch (error: any) {
        console.error("Audio transcription error:", error);
        return { success: false, error: `No se pudo transcribir el audio: ${error.message}` };
    }
}

export async function sendConsultationSummaryAction(specialist: Specialist): Promise<{ success: boolean; messageSent: boolean; error?: string; }> {
    try {
        const allPendingQuery = query(collection(db, "studies"), where('status', '==', 'Pendiente'));
        const snapshot = await getDocs(allPendingQuery);

        if (snapshot.empty) {
            return { success: true, messageSent: false };
        }

        const normalizeString = (str: string) => {
            if (!str) return '';
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        };

        const normalizedSpecialistSpecialty = normalizeString(specialist.specialty);

        const pendingStudiesForSpecialist = snapshot.docs
            .map(doc => doc.data() as Study)
            .filter(study => {
                const modality = study.studies[0]?.modality;
                return modality && normalizeString(modality) === normalizedSpecialistSpecialty;
            });

        if (pendingStudiesForSpecialist.length === 0) {
            return { success: true, messageSent: false };
        }

        const pendingCount = pendingStudiesForSpecialist.length;
        const studiesByService = pendingStudiesForSpecialist.reduce((acc, study) => {
            acc[study.service] = (acc[study.service] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const summaryText = Object.entries(studiesByService)
            .map(([service, count]) => `${service}: ${count}`)
            .join(' | ');
        
        const result = await sendWhatsAppMessage({
            to: specialist.phoneNumber,
            template: process.env.TWILIO_WHATSAPP_TEMPLATE_SID,
            templateVariables: {
                '1': specialist.name.split(' ')[0] || 'Doctor(a)',
                '2': String(pendingCount),
                '3': summaryText,
            },
        });

        if (result.success) {
            return { success: true, messageSent: true };
        } else {
            throw new Error(result.error);
        }

    } catch (error: any) {
        console.error(`[Notification Error] for ${specialist.name}:`, error);
        return { success: false, messageSent: false, error: `No se pudo enviar la notificación: ${error.message}` };
    }
}


export async function updateFinanceConfigAction(cost: number): Promise<{ success: boolean; error?: string }> {
    try {
        const configRef = doc(db, 'appConfig', 'finance');
        await setDoc(configRef, { costPerContrastVial: cost }, { merge: true });
        return { success: true };
    } catch (error: any) {
        console.error('Error updating finance config:', error);
        return { success: false, error: 'No se pudo guardar el costo.' };
    }
}

type RemissionRequest = {
    studyData: Omit<Study, 'id' | 'requestDate' | 'status'>;
    remissionData: {
        notaCargoUrl: string;
        ordenMedicaUrl: string;
        evolucionUrl: string;
    };
    userProfile: UserProfile;
};

export async function createRemissionAction(data: RemissionRequest): Promise<{ success: boolean; error?: string }> {
    const { studyData, remissionData, userProfile } = data;
    if (!userProfile) {
        return { success: false, error: 'Usuario no autenticado.' };
    }

    try {
        const now = new Date();
        const studyId = (studyData as Study).id;
        if (!studyId) {
            throw new Error("El ID del estudio es indefinido.");
        }
        
        const remissionRef = doc(db, "remissions", studyId);
        
        const finalDataForFirestore = {
            ...studyData,
            requiereContraste: false, // This seems to be a fixed value for remissions
            bajoSedacion: false,     // This seems to be a fixed value for remissions
            remissionFileUrls: remissionData,
            createdAt: serverTimestamp(),
            createdBy: {
                uid: userProfile.uid,
                name: userProfile.nombre
            },
            status: "Pendiente"
        };
        
        // Data for Google Sheets might need dates serialized
        const finalDataForSheets = {
            ...(studyData as Study),
            requiereContraste: false,
            bajoSedacion: false,
            remissionFileUrls: remissionData,
            createdAt: now,
            createdBy: {
                uid: userProfile.uid,
                name: userProfile.nombre
            },
            status: "Pendiente"
        };
        
        await Promise.all([
            setDoc(remissionRef, finalDataForFirestore, { merge: true }),
            appendOrUpdateRemissionSheet(finalDataForSheets as any, studyId)
        ]);

        return { success: true };

    } catch (error: any) {
        console.error("Error creating remission and updating sheet:", error);
        return { success: false, error: `No se pudo procesar la remisión: ${error.message}` };
    }
}


export async function updateRemissionStatusAction(remissionId: string, status: RemissionStatus): Promise<{ success: boolean, error?: string }> {
    try {
        const remissionRef = doc(db, 'remissions', remissionId);
        
        const updateData: { status: RemissionStatus; [key: string]: any } = { status };
        const now = serverTimestamp();

        if (status === 'Solicitado') {
            updateData.solicitadoAt = now;
        } else if (status === 'Autorizado') {
            updateData.autorizadoAt = now;
        } else if (status === 'Cupo Solicitado') {
            updateData.cupoSolicitadoAt = now;
        } else if (status === 'Programado') {
            updateData.programadoAt = now;
        } else if (status === 'Realizado') {
            updateData.realizadoAt = now;
        }

        await updateDoc(remissionRef, updateData);
        
        const updatedDoc = await getDoc(remissionRef);
        if (updatedDoc.exists()) {
             await appendOrUpdateRemissionSheet(updatedDoc.data() as any, remissionId);
        }

        return { success: true };
    } catch (error: any) {
        console.error(`Error updating remission status for ${remissionId}:`, error);
        return { success: false, error: `Failed to update remission status: ${error.message}` };
    }
}

export async function uploadAuthorizationAndUpdateRemissionAction(remissionId: string, fileDataUri: string, idToken: string): Promise<{ success: boolean, error?: string }> {
    if (!remissionId || !fileDataUri || !idToken) {
        return { success: false, error: "ID de remisión, archivo o token de usuario no proporcionado." };
    }

    try {
        // This admin-dependent logic is temporarily disabled.
        // if (!admin.apps.length) {
            return { success: false, error: "La funcionalidad de carga de archivos está temporalmente deshabilitada." };
        // }
        /*
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        
        const customToken = await admin.auth().createCustomToken(uid);
        
        const tempAuth = getAuth();
        await signInWithCustomToken(tempAuth, customToken);

        const remissionRef = doc(db, 'remissions', remissionId);
        const remissionSnap = await getDoc(remissionRef);
        if (!remissionSnap.exists()) {
            throw new Error("La remisión no existe.");
        }
        const remissionData = remissionSnap.data() as Remission;

        const safePatientName = remissionData.patient.fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toUpperCase();
        const patientFolder = `${safePatientName}_${remissionData.patient.id}`;
        const fileName = `authorization_${Date.now()}.pdf`;
        const folderPath = `remissions/${patientFolder}`;
        const storageRef = ref(storage, `${folderPath}/${fileName}`);

        const uploadResult = await uploadString(storageRef, fileDataUri, 'data_url', { contentType: 'application/pdf' });
        const downloadURL = await getDownloadURL(uploadResult.ref);

        await updateDoc(remissionRef, {
            'remissionFileUrls.authorizationUrl': downloadURL,
            status: 'Autorizado',
            autorizadoAt: serverTimestamp(),
        });
        
        const updatedDoc = await getDoc(remissionRef);
        if (updatedDoc.exists()) {
            await appendOrUpdateRemissionSheet(updatedDoc.data() as any, remissionId);
        }
        
        await tempAuth.signOut();

        return { success: true };
        */
    } catch (error: any) {
        console.error("Error uploading authorization:", error);
        return { success: false, error: `No se pudo subir la autorización: ${error.message}` };
    }
}

export async function uploadReminderAndUpdateRemissionAction(remissionId: string, fileDataUri: string, idToken: string): Promise<{ success: boolean; error?: string }> {
    if (!remissionId || !fileDataUri || !idToken) {
        return { success: false, error: "ID de remisión, archivo o token de usuario no proporcionado." };
    }

    try {
        // if (!admin.apps.length) {
             return { success: false, error: "La funcionalidad de carga de archivos está temporalmente deshabilitada." };
        // }
        /*
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const customToken = await admin.auth().createCustomToken(uid);
        
        const tempAuth = getAuth();
        await signInWithCustomToken(tempAuth, customToken);

        const remissionRef = doc(db, 'remissions', remissionId);
        const remissionSnap = await getDoc(remissionRef);
        if (!remissionSnap.exists()) {
            throw new Error("La remisión no existe.");
        }
        const remissionData = remissionSnap.data() as Remission;

        const safePatientName = remissionData.patient.fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toUpperCase();
        const patientFolder = `${safePatientName}_${remissionData.patient.id}`;
        const fileName = `reminder_${Date.now()}`;
        const folderPath = `remissions/${patientFolder}`;
        const storageRef = ref(storage, `${folderPath}/${fileName}`);
        
        const uploadResult = await uploadString(storageRef, fileDataUri, 'data_url');
        const downloadURL = await getDownloadURL(uploadResult.ref);

        await updateDoc(remissionRef, {
            'remissionFileUrls.recordatorioUrl': downloadURL,
            status: 'Programado',
            programadoAt: serverTimestamp(),
        });
        
        const updatedDoc = await getDoc(remissionRef);
        if (updatedDoc.exists()) {
            await appendOrUpdateRemissionSheet(updatedDoc.data() as any, remissionId);
        }

        await tempAuth.signOut();

        return { success: true };
        */
    } catch (error: any) {
        console.error("Error uploading reminder:", error);
        return { success: false, error: `No se pudo subir el recordatorio: ${error.message}` };
    }
}

export async function uploadReportAndUpdateRemissionAction(remissionId: string, fileDataUri: string, idToken: string): Promise<{ success: boolean; error?: string }> {
    if (!remissionId || !fileDataUri || !idToken) {
        return { success: false, error: "ID de remisión, archivo o token de usuario no proporcionado." };
    }

    try {
        // if (!admin.apps.length) {
             return { success: false, error: "La funcionalidad de carga de archivos está temporalmente deshabilitada." };
        // }
        /*
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const customToken = await admin.auth().createCustomToken(uid);
        
        const tempAuth = getAuth();
        await signInWithCustomToken(tempAuth, customToken);

        const remissionRef = doc(db, 'remissions', remissionId);
        const remissionSnap = await getDoc(remissionRef);
        if (!remissionSnap.exists()) {
            throw new Error("La remisión no existe.");
        }
        const remissionData = remissionSnap.data() as Remission;

        const safePatientName = remissionData.patient.fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toUpperCase();
        const patientFolder = `${safePatientName}_${remissionData.patient.id}`;
        const fileName = `informe_${Date.now()}`;
        const folderPath = `remissions/${patientFolder}`;
        const storageRef = ref(storage, `${folderPath}/${fileName}`);
        
        const uploadResult = await uploadString(storageRef, fileDataUri, 'data_url');
        const downloadURL = await getDownloadURL(uploadResult.ref);

        await updateDoc(remissionRef, {
            'remissionFileUrls.informeUrl': downloadURL,
            status: 'Realizado',
            realizadoAt: serverTimestamp(),
        });
        
        const updatedDoc = await getDoc(remissionRef);
        if (updatedDoc.exists()) {
            await appendOrUpdateRemissionSheet(updatedDoc.data() as any, remissionId);
        }
        
        await tempAuth.signOut();

        return { success: true };
        */
    } catch (error: any) {
        console.error("Error uploading report:", error);
        return { success: false, error: `No se pudo subir el informe: ${error.message}` };
    }
}


export async function scheduleRemissionAppointmentAction(remissionId: string, appointmentDate: string): Promise<{ success: boolean; error?: string }> {
    if (!remissionId || !appointmentDate) {
        return { success: false, error: "Faltan datos para agendar la cita." };
    }
    try {
        const remissionRef = doc(db, 'remissions', remissionId);
        const appointmentTimestamp = Timestamp.fromDate(new Date(appointmentDate));

        await updateDoc(remissionRef, {
            appointmentDate: appointmentTimestamp,
            status: 'Programado',
            programadoAt: serverTimestamp(),
        });
        
        const updatedDoc = await getDoc(remissionRef);
        if (updatedDoc.exists()) {
            await appendOrUpdateRemissionSheet(updatedDoc.data() as any, remissionId);
        }

        return { success: true };
    } catch (error: any) {
        console.error("Error scheduling appointment:", error);
        return { success: false, error: "No se pudo guardar la fecha de la cita." };
    }
}
    
