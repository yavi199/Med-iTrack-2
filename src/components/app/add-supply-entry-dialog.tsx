
"use client";

import { useState, useEffect } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { addMultipleInventoryEntriesAction } from '@/app/actions';
import type { InventoryItem } from '@/lib/types';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2, Search, DollarSign } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

const entrySchema = z.object({
    itemId: z.string().min(1, "Debes seleccionar un insumo."),
    itemName: z.string(),
    presentation: z.string(),
    service: z.enum(['RX', 'TAC', 'ECO', 'General'], { required_error: "Debes seleccionar un servicio."}),
    quantity: z.coerce.number().min(1, "Cantidad > 0."),
    lote: z.string().optional(),
    price: z.coerce.number().optional(), // Price is taken from the item, but kept for schema consistency
});

const formSchema = z.object({
  entries: z.array(entrySchema).min(1, "Debes añadir al menos un insumo."),
});

type FormData = z.infer<typeof formSchema>;

interface AddSupplyEntryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AddSupplyEntryDialog({ open, onOpenChange }: AddSupplyEntryDialogProps) {
    const { userProfile } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(-1);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

    useEffect(() => {
        if (!open) return;
        const q = query(collection(db, "inventoryItems"), orderBy("name"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const itemsData: InventoryItem[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
            setInventoryItems(itemsData);
        });
        return () => unsubscribe();
    }, [open]);

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            entries: [],
        },
    });

    const { fields, append, remove, update } = useFieldArray({
        control: form.control,
        name: "entries",
    });

    useEffect(() => {
        if (!open) {
            form.reset({ entries: [] });
        }
    }, [open, form]);

    const handleItemSelect = (index: number, item: InventoryItem) => {
        const displayName = item.specification ? `${item.name} ${item.specification}` : item.name;
        update(index, {
            ...form.getValues(`entries.${index}`),
            itemId: item.id,
            itemName: displayName,
            presentation: item.presentation,
            price: item.price || 0,
        });
        setPopoverOpen(-1);
    };

    const onSubmit = async (data: FormData) => {
        if (!userProfile) return;
        setLoading(true);

        const result = await addMultipleInventoryEntriesAction({
            entries: data.entries,
            userProfile,
        });

        if (result.success) {
            toast({ title: 'Entradas Registradas', description: 'Se han añadido los nuevos insumos al historial.' });
            onOpenChange(false);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Registrar Entrada de Insumos</DialogTitle>
                    <DialogDescription>
                        Añade uno o más insumos para registrar un nuevo pedido. Se creará una entrada en el historial para cada uno.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <ScrollArea className="h-96 w-full pr-4">
                            <div className="space-y-4">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="grid grid-cols-12 gap-3 items-start p-3 border rounded-lg">
                                        <div className="col-span-4">
                                            <FormLabel>Insumo</FormLabel>
                                            <Popover open={popoverOpen === index} onOpenChange={(isOpen) => setPopoverOpen(isOpen ? index : -1)}>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button variant="outline" className={cn("w-full justify-start font-normal", !field.itemName && "text-muted-foreground")}>
                                                            <Search className="mr-2 h-4 w-4" />
                                                            {field.itemName || "Buscar insumo..."}
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-[400px] p-0" align="start">
                                                    <Command>
                                                        <CommandInput placeholder="Buscar por nombre..." />
                                                        <CommandList>
                                                            <CommandEmpty>No se encontraron insumos.</CommandEmpty>
                                                            <CommandGroup>
                                                                {inventoryItems.map((item) => {
                                                                    const displayName = item.specification ? `${item.name} ${item.specification}` : item.name;
                                                                    return (
                                                                        <CommandItem
                                                                            key={item.id}
                                                                            value={displayName}
                                                                            onSelect={() => handleItemSelect(index, item)}
                                                                        >
                                                                            {displayName}
                                                                        </CommandItem>
                                                                    )
                                                                })}
                                                            </CommandGroup>
                                                        </CommandList>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage>{form.formState.errors.entries?.[index]?.itemId?.message}</FormMessage>
                                        </div>
                                         <FormField control={form.control} name={`entries.${index}.service`} render={({ field: serviceField }) => (
                                            <FormItem className="col-span-3">
                                                <FormLabel>Servicio</FormLabel>
                                                <Select onValueChange={serviceField.onChange} defaultValue={serviceField.value}>
                                                    <FormControl><SelectTrigger><SelectValue placeholder="Destino..." /></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="General">General</SelectItem>
                                                        <SelectItem value="RX">Rayos X</SelectItem>
                                                        <SelectItem value="TAC">Tomografía</SelectItem>
                                                        <SelectItem value="ECO">Ecografía</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage>{form.formState.errors.entries?.[index]?.service?.message}</FormMessage>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name={`entries.${index}.quantity`} render={({ field: qtyField }) => (
                                            <FormItem className="col-span-2">
                                                <FormLabel>Cantidad ({field.presentation})</FormLabel>
                                                <FormControl><Input type="number" placeholder="0" {...qtyField} /></FormControl>
                                                <FormMessage>{form.formState.errors.entries?.[index]?.quantity?.message}</FormMessage>
                                            </FormItem>
                                        )} />
                                         <FormField control={form.control} name={`entries.${index}.lote`} render={({ field: loteField }) => (
                                            <FormItem className="col-span-2">
                                                <FormLabel>Lote</FormLabel>
                                                <FormControl><Input placeholder="Opcional" {...loteField} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <div className="col-span-1 flex items-end h-full">
                                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                        
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => append({ itemId: '', itemName: '', presentation: '', service: 'General', quantity: 1, lote: '', price: 0 })}
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Añadir Insumo
                        </Button>
                        <FormMessage>{form.formState.errors.entries?.root?.message}</FormMessage>

                        <DialogFooter className="pt-4">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Registrar Entradas"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
