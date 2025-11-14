
"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { InventoryItem, InventoryStockEntry, InventoryConsumption } from '@/lib/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Beaker, AlertCircle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter as AlertDialogFooterComponent, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { Alert, AlertDescription as AlertDescriptionComponent, AlertTitle } from '../ui/alert';
import Link from 'next/link';

interface ContrastStockDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ContrastStockDialog({ open, onOpenChange }: ContrastStockDialogProps) {
    const { userProfile, inventoryItems, inventoryLoading } = useAuth();
    const [entries, setEntries] = useState<InventoryStockEntry[]>([]);
    const [consumptions, setConsumptions] = useState<InventoryConsumption[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyError, setHistoryError] = useState<string | null>(null);

    const contrastItems = useMemo(() => {
        return inventoryItems.filter(item => item.isContrast);
    }, [inventoryItems]);

    useEffect(() => {
        if (!open || !userProfile) return;

        if (contrastItems.length === 0) {
            setHistoryLoading(false);
            setEntries([]);
            setConsumptions([]);
            return;
        }

        setHistoryLoading(true);
        setHistoryError(null);
        const contrastItemIds = contrastItems.map(item => item.id);

        const entriesQuery = query(
            collection(db, 'inventoryEntries'),
            where('itemId', 'in', contrastItemIds),
            orderBy('date', 'desc')
        );

        const consumptionsQuery = query(
            collection(db, 'inventoryConsumptions'),
            where('itemId', 'in', contrastItemIds)
        );

        const unsubscribeEntries = onSnapshot(entriesQuery, (snapshot) => {
            const entryData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryStockEntry));
            setEntries(entryData);
            setHistoryLoading(false);
        }, (error) => {
            if (error.code !== 'permission-denied') {
                console.error("Error fetching contrast entries:", error);
                setHistoryError('No se pudo cargar el historial de entradas.');
            }
            setHistoryLoading(false);
        });

        const unsubscribeConsumptions = onSnapshot(consumptionsQuery, (snapshot) => {
            const consumptionData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryConsumption));
            setConsumptions(consumptionData);
        }, (error) => {
             if (error.code !== 'permission-denied') {
                console.error("Error fetching contrast consumptions:", error);
                setHistoryError('No se pudo cargar el historial de consumos.');
            }
        });

        return () => {
            unsubscribeEntries();
            unsubscribeConsumptions();
        };
    }, [open, contrastItems, userProfile]);


    const totalMl = useMemo(() => {
        const itemsMap = new Map(inventoryItems.map(item => [item.id, item]));
        
        const totalEntered = entries.reduce((acc, entry) => {
            const itemDetails = itemsMap.get(entry.itemId);
            return acc + (itemDetails ? entry.amountAdded * itemDetails.content : 0);
        }, 0);

        const totalConsumed = consumptions.reduce((acc, consumption) => {
            return acc + consumption.amountConsumed;
        }, 0);
        
        return totalEntered - totalConsumed;
    }, [entries, consumptions, inventoryItems]);


    if (inventoryLoading || !userProfile || userProfile.rol !== 'administrador') {
        return null;
    }

    if (contrastItems.length === 0) {
        return (
             <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Gestión de Medios de Contraste</DialogTitle>
                    </DialogHeader>
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>No se encontraron insumos de contraste</AlertTitle>
                        <AlertDescriptionComponent>
                            Para gestionar el stock, primero debes crear al menos un insumo y marcarlo como 'Contraste' en la página de inventario.
                        </AlertDescriptionComponent>
                    </Alert>
                    <DialogFooter>
                        <Button asChild><Link href="/inventory">Ir a Inventario</Link></Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="font-headline text-2xl">Gestión de Medios de Contraste</DialogTitle>
                    <DialogDescription>Consulta el historial de entradas y el stock total de contraste.</DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-6 pt-4">
                    <Card>
                         <CardHeader>
                           <div className='flex justify-between items-start'>
                                <div>
                                    <CardTitle>Estado Actual del Stock</CardTitle>
                                    <DialogDescription>Resumen del inventario total de contraste.</DialogDescription>
                                </div>
                           </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-4">
                                <Beaker className="h-12 w-12 text-primary" />
                                <div className="w-full">
                                    <div className="flex justify-between font-bold text-lg">
                                        <span>{Math.round(totalMl)} ml</span>
                                    </div>
                                    <Progress value={(totalMl / 1000) * 100} className="mt-2 h-2.5" />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Historial de Entradas</CardTitle>
                        </CardHeader>
                         <CardContent>
                            <ScrollArea className="h-64 border rounded-lg">
                                {historyLoading ? (
                                    <div className="flex items-center justify-center h-full text-muted-foreground">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Cargando...
                                    </div>
                                ) : historyError ? (
                                    <div className="p-4">
                                        <Alert variant="destructive">
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertTitle>Error</AlertTitle>
                                            <AlertDescriptionComponent>
                                                {historyError}
                                            </AlertDescriptionComponent>
                                        </Alert>
                                    </div>
                                ) : entries.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-muted-foreground">
                                        No hay historial de entradas.
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Descripción</TableHead>
                                                <TableHead className="text-right">Cantidad</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {entries.map((entry) => (
                                                <TableRow key={entry.id}>
                                                    <TableCell className="text-xs">{entry.date ? format(entry.date.toDate(), 'dd/MM/yy HH:mm') : 'N/A'}</TableCell>
                                                    <TableCell>
                                                        <p className="font-medium">{entry.itemName} ({entry.presentation})</p>
                                                        <p className="text-xs text-muted-foreground">Lote: {entry.lote}</p>
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-green-600">+{entry.amountAdded} {entry.presentation}(s)</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    );
}
