

import { type Timestamp } from "firebase/firestore";
import { type OrderDataSchema } from "./schemas/extract-order-schema";
import { z } from "zod";


export const UserRoles = ["administrador", "enfermero", "tecnologo", "transcriptora", "adminisonista"] as const;
export type UserRole = typeof UserRoles[number];

export const Modalities = ["TAC", "RX", "ECO", "MAMO", "DENSITOMETRIA", "RMN"] as const;
export type Modality = typeof Modalities[number];

export const GeneralServices = ["URG", "HOSP", "UCI", "C.EXT"] as const;
export type GeneralService = typeof GeneralServices[number];

export const SubServiceAreas: Record<GeneralService, readonly string[]> = {
    URG: ["TRIAGE", "OBSERVACION 1", "OBSERVACION 2"],
    HOSP: ["HOSPITALIZACION 2", "HOSPITALIZACION 4"],
    UCI: ["UCI 2", "UCI 3", "UCI NEO"],
    "C.EXT": ["AMB"],
};
export type SubServiceArea = typeof SubServiceAreas[keyof typeof SubServiceAreas][number];

export type OperationalStatus = 
    'Disponible' | 
    'En Cirugía' | 
    'No Disponible';

export type UserProfile = {
    uid: string;
    nombre: string;
    email: string;
    rol: UserRole;
    servicioAsignado: Modality | GeneralService | "General"; 
    subServicioAsignado?: SubServiceArea;
    activo: boolean;
    operationalStatus?: OperationalStatus;
    operadores?: string[];
    operadorActivo?: string | null;
    activeSurgerySessionId?: string | null;
};
    
export type StudyStatus = "Pendiente" | "Completado" | "Leído" | "Cancelado";

export type OrderData = z.infer<typeof OrderDataSchema>;

export type ContrastType = 'IV' | 'Bario';

export type Study = {
    id: string;
    status: StudyStatus;
    service: GeneralService;
    subService: SubServiceArea;
    patient: {
        fullName: string;
        id:string;
        idType?: string;
        entidad: string;
        birthDate?: string;
        sex?: string;
    };
    orderingPhysician?: {
        name: string;
        register: string;
    };
    studies: {
        nombre: string;
        cups: string;
        modality: string;
        details?: string;
    }[];
    diagnosis: {
        code: string;
        description: string;
    };
    orderDate?: Timestamp;
    admissionNumber?: string;
    referenceNumber?: string;
    requestDate: Timestamp;
    completionDate?: Timestamp;
    readingDate?: Timestamp;
    cancellationReason?: string;
    kV?: number;
    mA?: number;
    timeMs?: number;
    ctdi?: number;
    dlp?: number;
    contrastType?: ContrastType | null;
    creatinine?: number;
    contrastBilledMl?: number;
    contrastAdministeredMl?: number;
    contrastRemainingMl?: number;
    consumedSupplies?: ConsumedItem[];
    reportText?: string;
    reportUrl?: string;
    turnNumber?: string;
    bedNumber?: string;
    assignedSpecialistId?: string;
};

export type StudyWithCompletedBy = Study & {
    completedBy?: string;
};

export type RemissionStatus = "Pendiente" | "Solicitado" | "Autorizado" | "Cupo Solicitado" | "Programado" | "Vencido" | "Realizado";

export type Remission = Study & {
    status: RemissionStatus;
    remissionFileUrls: {
        notaCargoUrl: string;
        ordenMedicaUrl: string;
        evolucionUrl: string;
        authorizationUrl?: string;
        recordatorioUrl?: string;
        informeUrl?: string;
    };
    requiereContraste: boolean;
    bajoSedacion: boolean;
    createdBy: {
        uid: string;
        name: string;
    };
    createdAt: Timestamp; // This should exist on Remission
    solicitadoAt?: Timestamp;
    autorizadoAt?: Timestamp;
    cupoSolicitadoAt?: Timestamp;
    programadoAt?: Timestamp;
    realizadoAt?: Timestamp;
    appointmentDate?: Timestamp;
};


export type Message = {
    id: string;
    senderId: string;
    senderName: string;
    recipientRole: 'tecnologo' | 'transcriptora';
    content: string;
    createdAt: Timestamp;
    read: boolean;
};
    
export const InventoryCategories = ["contraste", "insumo"] as const;
export type InventoryCategory = typeof InventoryCategories[number];

export type InventoryItem = {
    id: string;
    name: string;
    category: InventoryCategory;
    presentation: 'Caja' | 'Frasco' | 'Unidad';
    content: number; // e.g., 100 (for 100 units in a box or 100ml in a vial)
    contentUnit: 'unidades' | 'ml' | 'g';
    specification?: string; // e.g., '#24', '100ml'
    stock: number; // Deprecated, but keep for now
    price?: number; // Price per presentation (e.g., cost of one box)
    isContrast?: boolean;
}

export type InventoryStockEntry = {
    id: string;
    itemId: string;
    itemName: string;
    amountAdded: number;
    presentation: InventoryItem['presentation'] | string;
    service: 'RX' | 'TAC' | 'ECO' | 'General';
    date: Timestamp;
    addedBy: {
        uid: string;
        name: string;
    };
    lote?: string;
    priceAtEntry?: number;
};

export type InventoryConsumption = {
    id: string;
    studyId: string;
    itemId: string;
    itemName: string;
    amountConsumed: number; // The amount in the item's native unit (e.g., ml, units)
    consumedBy: {
        uid: string;
        name: string;
    };
    date: Timestamp;
};


export type OperationalExpense = {
    id: string;
    category: 'Sueldos' | 'Servicios' | 'Arriendo' | 'Insumos' | 'Otro';
    description: string;
    amount: number;
    date: Timestamp;
};

export type ConsumedItem = {
    id: string; // ID of the InventoryItem
    name: string; // Name of the item for billing record
    amount: number; // Amount consumed (in units or ml)
};

export type Specialist = {
    id: string;
    name: string;
    specialty: string;
    phoneNumber: string;
};
