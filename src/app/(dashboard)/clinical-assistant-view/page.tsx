"use client";

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Study, GeneralService } from '@/lib/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, ArrowLeft, Bed, MapPin } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ModalityIcon } from '@/components/icons/modality-icon';

type PendingStudiesByService = {
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


export default function ClinicalAssistantViewPage() {
  const { userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [pendingStudies, setPendingStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);

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
    
    const studiesQuery = query(
      collection(db, "studies"), 
      where('status', '==', 'Pendiente'),
      where('service', 'in', ['URG', 'HOSP', 'UCI']),
      orderBy('service'),
      orderBy('requestDate', 'asc')
    );

    const unsubscribe = onSnapshot(studiesQuery, (snapshot) => {
      const allPendingStudies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Study));
      setPendingStudies(allPendingStudies);
      setLoading(false);
    }, (error) => {
        if (error.code !== 'permission-denied') {
            console.error("Error fetching clinical assistant studies:", error);
        }
        setLoading(false);
    });
    
    return () => unsubscribe();
  }, [userProfile]);

  const groupedStudies = useMemo<PendingStudiesByService[]>(() => {
    if (pendingStudies.length === 0) return [];

    const serviceMap: Record<string, Study[]> = {
      "URG": [], "HOSP": [], "UCI": []
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
  
  if (authLoading || loading) {
    return (
      <div className="container mx-auto py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="mt-4 text-muted-foreground">Cargando estudios intrahospitalarios...</p>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold font-headline">Pendientes Intrahospitalarios</h1>
        <p className="text-lg text-muted-foreground">
          Vista de todos los estudios de imagen pendientes en Urgencias, Hospitalización y UCI.
        </p>
      </div>

      {groupedStudies.length === 0 ? (
        <Card className="text-center py-20 bg-muted/50">
          <CardHeader>
            <CardTitle className="font-headline text-3xl">¡Sin pendientes!</CardTitle>
            <CardDescription className="text-lg">No hay estudios intrahospitalarios pendientes en este momento.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {groupedStudies.map(({ service, count, studies }) => (
            <Card key={service} className="flex flex-col">
              <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="font-headline text-2xl">{serviceDisplayNames[service]}</CardTitle>
                  <Badge variant="default" className="text-lg px-4 py-1">{count}</Badge>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                {studies.map(study => (
                  <div key={study.id} className="relative text-left p-4 border rounded-lg bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-200">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-lg">{study.patient.fullName}</p>
                      <div className="p-2 rounded-md bg-red-200 dark:bg-red-800/50">
                        <ModalityIcon className="h-6 w-6" />
                      </div>
                    </div>
                    <p className="text-sm opacity-80">{study.patient.idType} {study.patient.id}</p>
                    <Separator className="my-2 bg-red-300 dark:bg-red-500/30"/>
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>Estudio: <span className="font-semibold">{study.studies[0]?.nombre}</span></span>
                      </div>
                       <div className="flex items-center gap-2">
                        <Bed className="h-4 w-4" />
                        <span>Ubicación: <span className="font-semibold">{study.subService}{study.bedNumber && ` - Cama ${study.bedNumber}`}</span></span>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
