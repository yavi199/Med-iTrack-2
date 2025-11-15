"use client";

import { useMemo, useEffect, useState, useCallback } from 'react';
import type { InventoryItem, InventoryStockEntry } from '@/lib/types';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AddSupplyEntryDialog } from '@/components/app/add-supply-entry-dialog';
import { NewItemDialog } from '@/components/app/new-item-dialog';
import { Badge } from '@/components/ui/badge';

export default function InventoryPage() {
    const { userProfile, loading: authLoading } = useAuth();
    const router = useRouter();
    const [history, setHistory] = useState<InventoryStockEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [isAddSupplyDialogOpen, setIsAddSupplyDialogOpen] = useState(false);
    const [isNewItemDialogOpen, setIsNewItemDialogOpen] = useState(false);

    // Security check
    useEffect(() => {
        if (!authLoading && userProfile?.rol !== 'administrador') {
            router.push('/');
        }
    }, [userProfile, authLoading, router]);

    const fetchHistory = useCallback(() => {
        if (!userProfile || userProfile.rol !== 'administrador') {
            setHistory([]);
            setHistoryLoading(false);
            return;
        }

        setHistoryLoading(true);
        const q = query(
            collection(db, 'inventoryEntries'),
            orderBy('date', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryStockEntry));
            setHistory(entries);
            setHistoryLoading(false);
        }, (error) => {
            if (error.code !== 'permission-denied') {
                console.error(`Error fetching history:`, error);
            }
            setHistoryLoading(false);
        });

        return unsubscribe;
    }, [userProfile]);

    useEffect(() => {
        const unsubscribe = fetchHistory();
        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [fetchHistory]);

    
    if (authLoading || !userProfile || userProfile?.rol !== 'administrador') {
        return (
            <div className="container mx-auto py-6 space-y-6">
                <Skeleton className="h-8 w-48 mb-4" />
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-4 w-3/4" />
                    </CardHeader>
                    <CardContent>
                       <div className="space-y-4">
                           <Skeleton className="h-12 w-full" />
                           <Skeleton className="h-12 w-full" />
                           <Skeleton className="h-12 w-full" />
                       </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const formatCurrency = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

    return (
        <>
            <div className="container mx-auto py-6 space-y-6">
                <Card>
                    <CardHeader className="flex-row items-center justify-between">
                        <div>
                            <CardTitle>Historial de Entradas de Insumos</CardTitle>
                            <CardDescription>
                                Registra nuevos pedidos y consulta el historial de todas las entradas de insumos.
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                           <Button variant="outline" onClick={() => setIsNewItemDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Crear Nuevo Insumo
                           </Button>
                           <Button onClick={() => setIsAddSupplyDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Registrar Entrada
                           </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                         <ScrollArea className="h-[60vh] border rounded-lg">
                            {historyLoading ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <Loader2 className="h-6 w-6 animate-spin mr-2" /> Cargando...
                                </div>
                            ) : history.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    No hay historial de entradas registrado.
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Fecha y Hora</TableHead>
                                            <TableHead>Descripción del Insumo</TableHead>
                                            <TableHead>Servicio</TableHead>
                                            <TableHead>Cantidad</TableHead>
                                            <TableHead className="text-right">Costo Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.map((entry) => (
                                            <TableRow key={entry.id}>
                                                <TableCell className="text-xs">{entry.date ? format(entry.date.toDate(), 'dd/MM/yy HH:mm') : 'N/A'}</TableCell>
                                                <TableCell>
                                                    <p className="font-medium">{entry.itemName}</p>
                                                    <p className="text-xs text-muted-foreground">Lote: {entry.lote || 'N/A'}</p>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">{entry.service}</Badge>
                                                </TableCell>
                                                <TableCell className="font-semibold text-green-600">+{entry.amountAdded} {entry.presentation}(s)</TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    {formatCurrency((entry.priceAtEntry || 0) * entry.amountAdded)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
            <AddSupplyEntryDialog
                open={isAddSupplyDialogOpen}
                onOpenChange={setIsAddSupplyDialogOpen}
            />
            <NewItemDialog 
                open={isNewItemDialogOpen}
                onOpenChange={setIsNewItemDialogOpen}
            />
        </>
    );
}
