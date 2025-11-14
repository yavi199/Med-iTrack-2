
"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription as AlertDescriptionComponent, AlertTitle } from '../ui/alert';
import { AlertTriangle } from 'lucide-react';

const formSchema = z.object({
    creatinine: z.coerce.number().min(0.1, "El valor debe ser mayor a 0."),
});

type CreatinineFormData = z.infer<typeof formSchema>;

interface CreatininePromptDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (creatinine: number) => void;
    onCancel: () => void;
}

export function CreatininePromptDialog({ open, onOpenChange, onConfirm, onCancel }: CreatininePromptDialogProps) {
    const [loading, setLoading] = useState(false);
    const [showWarning, setShowWarning] = useState(false);
    const [creatinineValue, setCreatinineValue] = useState<number | null>(null);

    const form = useForm<CreatinineFormData>({
        resolver: zodResolver(formSchema),
        defaultValues: { creatinine: '' as any },
    });

    const onSubmit = (data: CreatinineFormData) => {
        setLoading(true);
        if (data.creatinine > 1.6) {
            setCreatinineValue(data.creatinine);
            setShowWarning(true);
            setLoading(false);
        } else {
            handleConfirm(data.creatinine);
        }
    };
    
    const handleConfirm = (creatinine: number) => {
        onConfirm(creatinine);
        form.reset();
        setLoading(false);
        setShowWarning(false);
        onOpenChange(false);
    }

    const handleCancel = () => {
        onCancel();
        onOpenChange(false);
        form.reset();
    };
    
    const handleWarningCancel = () => {
        setCreatinineValue(null);
        setShowWarning(false);
    }

    return (
        <>
            <Dialog open={open && !showWarning} onOpenChange={onOpenChange}>
                <DialogContent onEscapeKeyDown={handleCancel} onPointerDownOutside={handleCancel}>
                    <DialogHeader>
                        <DialogTitle className="font-headline">Se Requiere Creatinina</DialogTitle>
                        <DialogDescription>
                            La IA ha detectado que uno o más estudios en la orden requieren contraste intravenoso. Por favor, ingrese el valor de creatinina del paciente para continuar.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <Alert variant="destructive" className="mt-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>¡Atención!</AlertTitle>
                        <AlertDescriptionComponent>
                            Esta acción creará las solicitudes y les asignará automáticamente el estado de contraste IV.
                        </AlertDescriptionComponent>
                    </Alert>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                            <FormField
                                control={form.control}
                                name="creatinine"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Valor de Creatinina (mg/dL)</FormLabel>
                                        <FormControl>
                                            <Input 
                                                type="number" 
                                                step="0.01"
                                                placeholder="Ej: 0.9" 
                                                autoFocus
                                                {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <DialogFooter className="pt-4">
                                <Button type="button" variant="outline" onClick={handleCancel}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={loading}>
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Confirmar y Crear Solicitudes"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-6 w-6 text-amber-500" />
                            <span>Valor de Creatinina Elevado</span>
                        </AlertDialogTitle>
                        <AlertDialogDescription className="pt-2">
                            El valor de creatinina ingresado ({creatinineValue} mg/dL) es alto. Esto puede incrementar el riesgo de nefropatía inducida por contraste. ¿Desea ordenar el estudio de todos modos?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleWarningCancel}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            if (creatinineValue !== null) {
                                handleConfirm(creatinineValue);
                            }
                        }}>
                            Ordenar Igualmente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
