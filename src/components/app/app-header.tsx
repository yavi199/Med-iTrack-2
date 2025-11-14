
"use client";

import { useAuth } from "@/context/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon, UserPlus, Download, Users, LifeBuoy, Package, Beaker, ShieldPlus, FileText, FileBarChart, HardDrive, DollarSign, Eye, Tv, VolumeX, Loader2, Stethoscope, BriefcaseMedical, FileSpreadsheet, MessageSquare } from "lucide-react";
import Link from 'next/link';
import { AppLogoIcon } from "@/components/icons/app-logo-icon";
import { useState, useMemo, useEffect } from "react";
import { ExportDialog } from "./export-dialog";
import { MessagingDrawer } from "./messaging-drawer";
import { HelpTutorialDialog } from "./help-tutorial-dialog";
import { tutorialData } from "@/lib/tutorial-data";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { ContrastStockDialog } from "./contrast-stock-dialog";
import { ImpersonationDialog } from "./impersonation-dialog";
import { useToast } from "@/hooks/use-toast";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryItem, InventoryStockEntry, InventoryConsumption, UserProfile } from "@/lib/types";
import { AssignOperatorDialog } from "./assign-operator-dialog";
import { setActiveOperatorAction } from "@/app/actions";

function HeaderContrastIndicator() {
    const { inventoryItems, inventoryLoading: authInventoryLoading } = useAuth();
    const [isContrastDialogOpen, setIsContrastDialogOpen] = useState(false);
    const [totalMl, setTotalMl] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authInventoryLoading) return;

        const contrastItems = inventoryItems.filter(item => item.isContrast);
        if (contrastItems.length === 0) {
            setTotalMl(0);
            setLoading(false);
            return;
        }

        const contrastItemIds = contrastItems.map(item => item.id);
        const itemsMap = new Map(contrastItems.map(item => [item.id, item]));

        const entriesQuery = query(
            collection(db, 'inventoryEntries'),
            where('itemId', 'in', contrastItemIds)
        );

        const consumptionsQuery = query(
            collection(db, 'inventoryConsumptions'),
            where('itemId', 'in', contrastItemIds)
        );

        const unsubEntries = onSnapshot(entriesQuery, (entrySnapshot) => {
            const unsubConsumptions = onSnapshot(consumptionsQuery, (consumptionSnapshot) => {
                let currentTotalMl = 0;
                entrySnapshot.forEach(doc => {
                    const entry = doc.data() as InventoryStockEntry;
                    const itemDetails = itemsMap.get(entry.itemId);
                    if (itemDetails) {
                        currentTotalMl += entry.amountAdded * itemDetails.content;
                    }
                });

                consumptionSnapshot.forEach(doc => {
                    const consumption = doc.data() as InventoryConsumption;
                    currentTotalMl -= consumption.amountConsumed;
                });
                
                setTotalMl(currentTotalMl);
                setLoading(false);
            });
            return () => unsubConsumptions();
        }, (error) => {
            if (error.code !== 'permission-denied') {
                console.error("Error fetching contrast entries for header:", error);
            }
            setLoading(false);
        });

        return () => unsubEntries();

    }, [inventoryItems, authInventoryLoading]);

    if (loading) {
        return <Skeleton className="h-9 w-24 rounded-full" />;
    }

    return (
        <>
            <button 
                onClick={() => setIsContrastDialogOpen(true)} 
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
                <Beaker className="h-5 w-5" />
                <span className="text-sm font-bold">{Math.round(totalMl)} ml</span>
            </button>
            <ContrastStockDialog open={isContrastDialogOpen} onOpenChange={setIsContrastDialogOpen} />
        </>
    );
}


function AdverseEventReporter() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="destructive" size="icon" className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm">
                    <ShieldPlus className="h-5 w-5" />
                    <span className="sr-only">Reportar Evento Adverso</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Reporte de Seguridad</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <a href="https://docs.google.com/forms/d/1l-Pi7tMeUa9cfjIcBoZo5sFlkglutOKuxLKYQyM5azU/viewform?edit_requested=true" target="_blank" rel="noopener noreferrer">
                        <FileBarChart className="mr-2 h-4 w-4" />
                        <span>Evento Adverso (Formulario)</span>
                    </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a href="/docs/formato_farmacovigilancia.docx" download>
                        <FileText className="mr-2 h-4 w-4" />
                        <span>Fármacovigilancia (Documento)</span>
                    </a>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function AppHeader() {
  const { user, userProfile, currentProfile, selectedOperator, signOut, isImpersonating, stopImpersonating, startImpersonating } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isImpersonationDialogOpen, setIsImpersonationDialogOpen] = useState(false);
  const [isAssignRadiologistOpen, setIsAssignRadiologistOpen] = useState(false);
  const [loadingAssignment, setLoadingAssignment] = useState(false);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };
  
  const shouldShowOperatorView = selectedOperator && (currentProfile?.rol === 'tecnologo' || currentProfile?.rol === 'transcriptora');
  const canChangeOperator = currentProfile?.rol === 'transcriptora';
  
  const handleAssignOperator = async (operatorName: string) => {
    if (!userProfile) return;
    setLoadingAssignment(true);
    const result = await setActiveOperatorAction(userProfile.uid, operatorName);
    if (result.success) {
      toast({ title: "Operador Asignado", description: `${operatorName} ahora está de turno.` });
       if(isImpersonating){
           startImpersonating({ ...currentProfile, operadorActivo: operatorName } as any);
       }
    } else {
      toast({ variant: "destructive", title: "Error", description: result.error });
    }
    setLoadingAssignment(false);
    setIsAssignRadiologistOpen(false);
  };

  const hasTutorial = currentProfile && tutorialData[currentProfile.rol] && tutorialData[currentProfile.rol].length > 0;
  
  return (
    <>
      <header className="theme-yellow sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3">
              <AppLogoIcon className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold font-headline tracking-tight">Med-iTrack</h1>
              </div>
            </Link>
          </div>
          
          {user && currentProfile && (
            <div className="flex items-center gap-2">
              
              <div className="flex items-center gap-1 bg-background p-1 rounded-full border shadow-inner">
                {currentProfile?.rol === 'administrador' && <HeaderContrastIndicator />}
                 {currentProfile?.rol === 'administrador' && (
                  <Button variant="default" size="icon" className="h-8 w-8 rounded-full bg-green-600 text-primary-foreground hover:bg-green-700 shadow-sm" asChild>
                    <Link href="/remissions">
                      <FileSpreadsheet className="h-5 w-5" />
                      <span className="sr-only">Abrir Remisiones</span>
                    </Link>
                  </Button>
                )}
                
                {hasTutorial && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsHelpOpen(true)}>
                      <LifeBuoy className="h-5 w-5" />
                  </Button>
                )}

                <AdverseEventReporter />
              </div>
              
              <Separator orientation="vertical" className="h-8" />

              <div className="flex items-center gap-2">
                 {userProfile?.rol === 'administrador' && (
                  <button onClick={() => setIsImpersonationDialogOpen(true)} className="hover:text-primary transition-colors">
                    <Eye className="h-5 w-5" />
                  </button>
                )}
                 {isImpersonating && (
                  <Button onClick={stopImpersonating} variant="destructive" size="sm" className="h-auto px-2 py-1 text-xs">
                    <LogOut className="mr-1 h-3 w-3" />
                    Salir
                  </Button>
                )}

                {shouldShowOperatorView && (
                  <button 
                    className="text-right text-sm disabled:cursor-not-allowed"
                    onClick={() => canChangeOperator && setIsAssignRadiologistOpen(true)}
                    disabled={!canChangeOperator || loadingAssignment}
                  >
                    <div className="font-bold">{selectedOperator}</div>
                    <div className="text-xs text-muted-foreground">Operando como {currentProfile.nombre}</div>
                  </button>
                )}
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button>
                        <Avatar className="h-9 w-9">
                            {currentProfile.rol === 'administrador' ? (
                                <AvatarImage src="/avatar-admin.png" alt="Admin Avatar" />
                            ) : (
                                <AvatarFallback className="font-bold text-muted-foreground">
                                    {getInitials(currentProfile.nombre)}
                                </AvatarFallback>
                            )}
                        </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{currentProfile.nombre}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {currentProfile.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link href="/profile">
                        <UserIcon className="mr-2 h-4 w-4" />
                        <span>Perfil</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                       <div className="w-full">
                          <MessagingDrawer />
                       </div>
                    </DropdownMenuItem>

                    {userProfile?.rol === 'administrador' && (
                      <>
                        <DropdownMenuSub>
                           <DropdownMenuSubTrigger>
                                <HardDrive className="mr-2 h-4 w-4" />
                                <span>Administración</span>
                           </DropdownMenuSubTrigger>
                           <DropdownMenuPortal>
                               <DropdownMenuSubContent>
                                    <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/signup">
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            <span>Crear Usuario</span>
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/users">
                                            <Users className="mr-2 h-4 w-4" />
                                            <span>Gestionar Usuarios</span>
                                        </Link>
                                    </DropdownMenuItem>
                                     <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/specialists">
                                            <Stethoscope className="mr-2 h-4 w-4" />
                                            <span>Gestionar Especialistas</span>
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/inventory">
                                            <Package className="mr-2 h-4 w-4" />
                                            <span>Inventario General</span>
                                        </Link>
                                    </DropdownMenuItem>
                                     <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/statistics">
                                            <FileBarChart className="mr-2 h-4 w-4" />
                                            <span>Estadísticas</span>
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/clinical-assistant-view">
                                            <BriefcaseMedical className="mr-2 h-4 w-4" />
                                            <span>Vista Aux. Clínica</span>
                                        </Link>
                                    </DropdownMenuItem>
                                     <DropdownMenuItem asChild className="cursor-pointer">
                                        <Link href="/turnero" target="_blank">
                                            <Tv className="mr-2 h-4 w-4" />
                                            <span>Turnero</span>
                                        </Link>
                                    </DropdownMenuItem>
                               </DropdownMenuSubContent>
                           </DropdownMenuPortal>
                        </DropdownMenuSub>
                        
                        <DropdownMenuItem onClick={() => setIsExportDialogOpen(true)} className="cursor-pointer">
                          <Download className="mr-2 h-4 w-4" />
                          <span>Exportar Datos</span>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Cerrar sesión</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </div>
      </header>
      <ExportDialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen} />
      {currentProfile && <HelpTutorialDialog open={isHelpOpen} onOpenChange={setIsHelpOpen} role={currentProfile.rol} />}
      <ImpersonationDialog open={isImpersonationDialogOpen} onOpenChange={setIsImpersonationDialogOpen} />
      {currentProfile && (
        <AssignOperatorDialog
            open={isAssignRadiologistOpen}
            onOpenChange={setIsAssignRadiologistOpen}
            title="Asignar Radiólogo de Turno"
            description="Seleccione el radiólogo que estará a cargo de las ecografías."
            operators={currentProfile.operadores || []}
            onAssign={handleAssignOperator}
         />
      )}
    </>
  );
}
