
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Study, GeneralService } from '@/lib/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ALL_CONSULTATIONS } from '@/lib/consultations-data';
import { updateStudyStatusAction } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, ArrowLeft, User, MapPin, Stethoscope, Briefcase, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

type PendingConsultationsByService = {
  service: GeneralService;
  count: number;
  studies: Study[];
};

const serviceDisplayNames: Record<GeneralService, string> = {
  "URG": "Urgencias",
  "HOSP": "Hospitalización",
  "UCI": "Unidad de Cuidados Intensivos",
  "C.EXT": "Consulta Externa",
};

const uniqueSpecialties = new Set(ALL_CONSULTATIONS.map(c => c.especialidad));

export default function SpecialistViewPage() {
  const { userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [pendingStudies, setPendingStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const normalizeString = (str: string) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : '';

  useEffect(() => {
    if (!authLoading && !userProfile) {
      router.push('/login');
    }
  }, [userProfile, authLoading, router]);

  useEffect(() => {
    if (!userProfile) {
        setPendingStudies([]);
        setLoading(false);
        return;
    }

    setLoading(true);
    const normalizedSpecialty = normalizeString(userProfile.servicioAsignado);
    
    const studiesQuery = query(
      collection(db, "studies"), 
      where('status', '==', 'Pendiente'),
      orderBy('requestDate', 'asc')
    );

    const unsubscribe = onSnapshot(studiesQuery, (snapshot) => {
      const allPendingStudies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Study));
      
      let relevantStudies;
      if (userProfile.rol === 'administrador') {
          // Admin sees all consultations
          relevantStudies = allPendingStudies.filter(study => {
              const modality = study.studies[0]?.modality;
              return modality && uniqueSpecialties.has(modality);
          });
      } else {
          // Specialists see only their assigned specialty
          relevantStudies = allPendingStudies.filter(study => {
              const modality = study.studies[0]?.modality;
              return modality && uniqueSpecialties.has(modality) && normalizeString(modality) === normalizedSpecialty;
          });
      }

      setPendingStudies(relevantStudies);
      setLoading(false);
    }, (error) => {
        if (error.code !== 'permission-denied') {
            console.error("Error fetching specialist studies:", error);
        }
        setLoading(false);
    });
    
    return () => unsubscribe();
  }, [userProfile]);

  const groupedStudies = useMemo<PendingConsultationsByService[]>(() => {
    if (pendingStudies.length === 0) return [];

    const serviceMap: Record<string, Study[]> = {
      "URG": [], "HOSP": [], "UCI": [], "C.EXT": []
    };

    pendingStudies.forEach(study => {
      if (serviceMap[study.service]) {
        serviceMap[study.service].push(study);
      }
    });

    return Object.entries(serviceMap)
      .map(([service, studies]) => ({
        service: service as GeneralService,
        count: studies.length,
        studies: studies,
      }))
      .filter(group => group.count > 0)
      .sort((a, b) => b.count - a.count);

  }, [pendingStudies]);
  
  const handleComplete = async (studyId: string) => {
    if (!userProfile) return;
    setUpdatingId(studyId);
    const result = await updateStudyStatusAction(studyId, 'Completado', userProfile, undefined, userProfile.nombre);
    if (result.success) {
      toast({
        title: "Interconsulta Completada",
        description: "El estudio ha sido marcado como completado.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: result.error || "No se pudo completar la interconsulta.",
      });
    }
    setUpdatingId(null);
  }

  if (authLoading || loading) {
    return (
      <div className="container mx-auto py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="mt-4 text-muted-foreground">Cargando interconsultas...</p>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold font-headline">Interconsultas Pendientes</h1>
        <p className="text-lg text-muted-foreground">
          {userProfile?.rol === 'administrador' 
              ? 'Vista global de todas las interconsultas pendientes por servicio.' 
              : `Resumen de las solicitudes asignadas para ${userProfile?.servicioAsignado}.`
          }
        </p>
      </div>

      {groupedStudies.length === 0 ? (
        <Card className="text-center py-20 bg-muted/50">
          <CardHeader>
            <CardTitle className="font-headline text-3xl">¡Todo al día!</CardTitle>
            <CardDescription className="text-lg">No hay interconsultas pendientes en este momento.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/consultations">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {groupedStudies.map(({ service, count, studies }) => (
            <Card key={service} className="flex flex-col">
              <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="font-headline text-2xl">{serviceDisplayNames[service]}</CardTitle>
                  <Badge variant="default" className="text-lg px-4 py-1">{count}</Badge>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                {studies.map(study => (
                    <AlertDialog key={study.id}>
                        <AlertDialogTrigger asChild>
                             <button className="relative text-left p-4 border rounded-lg bg-orange-600 text-white transition-all group hover:bg-orange-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">
                                {updatingId === study.id ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-orange-700/80 rounded-lg">
                                        <Loader2 className="h-8 w-8 animate-spin" />
                                    </div>
                                ) : (
                                   <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                       <CheckCircle className="h-10 w-10 text-white"/>
                                   </div>
                                )}
                                <div className="flex items-center justify-between">
                                <p className="font-bold text-lg">{study.patient.fullName}</p>
                                <Badge variant="secondary" className="uppercase bg-white text-orange-900">{study.studies[0]?.modality}</Badge>
                                </div>
                                <p className="text-sm text-white/80">{study.patient.idType} {study.patient.id}</p>
                                <Separator className="my-2 bg-white/30"/>
                                <div className="text-sm text-white/90 space-y-1">
                                <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-white" />
                                    <span>Ubicación: <span className="font-semibold">{study.subService}{study.bedNumber && ` - Cama ${study.bedNumber}`}</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Stethoscope className="h-4 w-4 text-white" />
                                    <span>Diagnóstico: <span className="font-semibold">{study.diagnosis.description}</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Briefcase className="h-4 w-4 text-white" />
                                    <span>Entidad: <span className="font-semibold">{study.patient.entidad}</span></span>
                                </div>
                                </div>
                            </button>
                        </AlertDialogTrigger>
                         <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>¿Marcar esta interconsulta como completada?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta acción cambiará el estado del estudio a "Completado" y lo moverá fuera de la lista de pendientes. No se puede deshacer fácilmente.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleComplete(study.id)}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
