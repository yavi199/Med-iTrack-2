
"use client";

import * as React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, onSnapshot, where, Timestamp, orderBy, getDocs, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import type { StudyWithCompletedBy, Modality, GeneralService, OperationalExpense, InventoryStockEntry, Study } from '@/lib/types';
import { format, startOfDay, endOfDay, differenceInMinutes, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { updateFinanceConfigAction, addOperationalExpenseAction, updateOperationalExpenseAction, deleteOperationalExpenseAction } from '@/app/actions';


import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft, Hourglass, BarChart, Droplets, Calendar as CalendarIcon, Syringe, PieChart, Clock, DollarSign, Package, Beaker, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modalities, GeneralServices } from '@/lib/types';
import { SyringeIcon } from '@/components/icons/syringe-icon';
import type { DateRange } from 'react-day-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, PieChart as RechartsPieChart, Pie, Cell, Sector } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { DateRangePicker } from '@/components/ui/date-range-picker';

const expenseCategories = ['Sueldos', 'Servicios', 'Arriendo', 'Insumos', 'Otro'] as const;

const expenseSchema = z.object({
    id: z.string().optional(),
    category: z.enum(expenseCategories),
    description: z.string().min(3, "La descripción es muy corta."),
    amount: z.coerce.number().min(1, "El monto debe ser mayor a 0."),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ElementType;
    loading?: boolean;
    unit?: string;
    formatFn?: (val: number) => string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, loading, unit, formatFn }) => (
    <div className="flex items-center p-3 rounded-lg bg-muted border">
        <Icon className="h-6 w-6 mr-3 text-primary" />
        <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : 
             <p className="text-xl font-bold">
                 {typeof value === 'number' && formatFn ? formatFn(value) : value}
                 {unit && <span className="text-xs ml-1">{unit}</span>}
            </p>
            }
        </div>
    </div>
);


type GroupingKey = 'modality' | 'service' | 'entidad';
const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

const renderActiveShape = (props: any) => {
  const RADIAN = Math.PI / 180;
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  const sin = Math.sin(-RADIAN * midAngle);
  const cos = Math.cos(-RADIAN * midAngle);
  const sx = cx + (outerRadius + 10) * cos;
  const sy = cy + (outerRadius + 10) * sin;
  const mx = cx + (outerRadius + 30) * cos;
  const my = cy + (outerRadius + 30) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 22;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} className="font-bold text-lg">
        {payload.name}
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius} startAngle={startAngle} endAngle={endAngle} fill={fill}/>
      <Sector cx={cx} cy={cy} startAngle={startAngle} endAngle={endAngle} innerRadius={outerRadius + 6} outerRadius={outerRadius + 10} fill={fill}/>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
      <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
      <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} textAnchor={textAnchor} fill="#333">{`${value} (${(percent * 100).toFixed(0)}%)`}</text>
    </g>
  );
};

type StatusHistoryEntry = {
    id: string;
    startTime: Timestamp;
    endTime: Timestamp | null;
    durationMinutes: number | null;
}

function ExpenseDialog({ open, onOpenChange, expense, onSave }: { open: boolean, onOpenChange: (open: boolean) => void, expense: OperationalExpense | null, onSave: (data: ExpenseFormData) => Promise<void> }) {
    const form = useForm<ExpenseFormData>({
        resolver: zodResolver(expenseSchema),
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (expense) {
            form.reset({
                id: expense.id,
                category: expense.category,
                description: expense.description,
                amount: expense.amount,
            });
        } else {
            form.reset({
                category: undefined,
                description: '',
                amount: '' as any,
            });
        }
    }, [expense, form]);

    const onSubmit = async (data: ExpenseFormData) => {
        setLoading(true);
        await onSave(data);
        setLoading(false);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{expense ? 'Editar Gasto' : 'Añadir Nuevo Gasto'}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField control={form.control} name="category" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Categoría</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar categoría..." /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {expenseCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="description" render={({ field }) => ( <FormItem><FormLabel>Descripción</FormLabel><FormControl><Input placeholder="Ej: Nómina quincena..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                        <FormField control={form.control} name="amount" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Monto (COP)</FormLabel>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <FormControl><Input type="number" className="pl-9" placeholder="0" {...field} /></FormControl>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {expense ? 'Guardar Cambios' : 'Añadir Gasto'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export default function StatisticsPage() {
    const { userProfile, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [allStudies, setAllStudies] = useState<StudyWithCompletedBy[]>([]);
    const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [service, setService] = useState('ALL');
    const [modality, setModality] = useState('ALL');
    const [volumeChartGrouping, setVolumeChartGrouping] = useState<GroupingKey>('modality');
    const [activeIndex, setActiveIndex] = useState(0);

    const [opExpenses, setOpExpenses] = useState<OperationalExpense[]>([]);
    const [supplyEntries, setSupplyEntries] = useState<InventoryStockEntry[]>([]);
    const [costPerVial, setCostPerVial] = useState(0);
    const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<OperationalExpense | null>(null);

    const formatCurrency = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

    const onPieEnter = useCallback((_: any, index: number) => {
        setActiveIndex(index);
    }, [setActiveIndex]);

    useEffect(() => {
        if (!authLoading && userProfile?.rol !== 'administrador') {
            router.push('/');
        }
    }, [userProfile, authLoading, router]);

    const fetchData = useCallback((range: DateRange | undefined) => {
        if (userProfile?.rol !== 'administrador' || !range?.from) {
            setAllStudies([]);
            setStatusHistory([]);
            setOpExpenses([]);
            setSupplyEntries([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const fromDate = startOfDay(range.from);
        const toDate = range.to ? endOfDay(range.to) : endOfDay(range.from);

        const studiesQuery = query(collection(db, "studies"), where('requestDate', '>=', Timestamp.fromDate(fromDate)), where('requestDate', '<=', Timestamp.fromDate(toDate)), orderBy('requestDate', 'desc'));
        const statusHistoryQuery = query(collection(db, "operationalStatusHistory"), where('startTime', '>=', Timestamp.fromDate(fromDate)), where('startTime', '<=', Timestamp.fromDate(toDate)));
        const expensesQuery = query(collection(db, "operationalExpenses"), where('date', '>=', Timestamp.fromDate(fromDate)), where('date', '<=', Timestamp.fromDate(toDate)), orderBy('date', 'desc'));
        const suppliesQuery = query(collection(db, "inventoryEntries"), where('date', '>=', Timestamp.fromDate(fromDate)), where('date', '<=', Timestamp.fromDate(toDate)), orderBy('date', 'desc'));
        const configRef = doc(db, 'appConfig', 'finance');
        
        const unsubscribes = [
            onSnapshot(studiesQuery, (s) => setAllStudies(s.docs.map(d => ({id:d.id, ...d.data(), requestDate: d.data().requestDate?.toDate(), completionDate: d.data().completionDate?.toDate(), readingDate: d.data().readingDate?.toDate(), orderDate: d.data().orderDate?.toDate() } as StudyWithCompletedBy)))),
            onSnapshot(statusHistoryQuery, (s) => setStatusHistory(s.docs.map(d => ({ id: d.id, ...d.data() } as StatusHistoryEntry)))),
            onSnapshot(expensesQuery, (s) => setOpExpenses(s.docs.map(d => ({ id: d.id, ...d.data() } as OperationalExpense)))),
            onSnapshot(suppliesQuery, (s) => setSupplyEntries(s.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryStockEntry)))),
            onSnapshot(configRef, (docSnap) => { if (docSnap.exists()) { setCostPerVial(docSnap.data().costPerContrastVial || 0); } }),
        ];
        
        const allPromises = unsubscribes.map(unsub => new Promise<() => void>((resolve) => {
            const unsubFunc = unsub;
            const timeout = setTimeout(() => {
                resolve(unsubFunc);
            }, 1500);
            // This is a simplified approach; in a real app, you might use the first snapshot as a signal
        }));
        
        Promise.all(allPromises).catch(error => console.error("Error fetching data: ", error)).finally(() => setLoading(false));

        return () => unsubscribes.forEach(unsub => unsub && unsub());

    }, [userProfile]);

    const filteredStudies = useMemo(() => {
        let studies = allStudies;
        if (service !== 'ALL') studies = studies.filter(s => s.service === service);
        if (modality !== 'ALL') studies = studies.filter(s => s.studies.some(st => st.modality === modality));
        return studies;
    }, [allStudies, service, modality]);
    
    const { monthlyTotal, allSupplyEntries } = useMemo(() => {
        const opTotal = opExpenses.reduce((acc, exp) => acc + exp.amount, 0);
        const allEntries = supplyEntries.map(entry => ({...entry, cost: (entry.priceAtEntry || 0) * entry.amountAdded}));
        const suppliesTotal = allEntries.reduce((acc, entry) => acc + entry.cost, 0);
        return { monthlyTotal: opTotal + suppliesTotal, allSupplyEntries: allEntries };
    }, [opExpenses, supplyEntries]);

    const contrastAnalysis = useMemo(() => {
        const completedStudies = filteredStudies.filter(s => s.status === 'Completado' || s.status === 'Leído');
        const result = completedStudies.reduce((acc, study) => {
            acc.billed += study.contrastBilledMl || 0;
            acc.administered += study.contrastAdministeredMl || 0;
            return acc;
        }, { billed: 0, administered: 0 });
        result.remaining = result.billed - result.administered;
        return result;
    }, [filteredStudies]);

    const estimatedSavings = useMemo(() => {
        if (!costPerVial || costPerVial <= 0) return 0;
        const vialsSaved = contrastAnalysis.remaining / 100;
        return vialsSaved * costPerVial;
    }, [contrastAnalysis, costPerVial]);


    const kpis = useMemo(() => {
        const completed = filteredStudies.filter(s => s.status === 'Completado' || s.status === 'Leído');
        const totalStudies = completed.length;
        const turnaroundTimes = completed.map(s => s.completionDate && s.requestDate ? differenceInMinutes(s.completionDate, s.requestDate) : null).filter((t): t is number => t !== null);
        const avgTurnaround = turnaroundTimes.length > 0 ? turnaroundTimes.reduce((a, b) => a + b, 0) / turnaroundTimes.length : 0;
        let avgTurnaroundFormatted = "N/A";
        if (avgTurnaround > 0) {
            const hours = Math.floor(avgTurnaround / 60);
            const minutes = Math.round(avgTurnaround % 60);
            avgTurnaroundFormatted = `${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
        }
        const contrastStudies = completed.filter(s => !!s.contrastType).length;
        const totalSurgeryMinutes = statusHistory.reduce((acc, entry) => acc + (entry.durationMinutes || 0), 0);
        const surgeryHours = Math.floor(totalSurgeryMinutes / 60);
        const surgeryMinutes = Math.round(totalSurgeryMinutes % 60);
        const surgeryTimeFormatted = `${surgeryHours}h ${surgeryMinutes}m`;
        return { totalStudies, avgTurnaroundFormatted, contrastStudies, surgeryTimeFormatted };
    }, [filteredStudies, statusHistory]);

    const volumeChartData = useMemo(() => {
        const dataMap = new Map<string, number>();
        const imagingModalities = ["TAC", "RX", "ECO", "RMN", "MAMO", "DENSITOMETRIA"];
        const getChartKey = (study: StudyWithCompletedBy): string | undefined => {
            if (volumeChartGrouping === 'modality') return imagingModalities.includes(study.studies[0]?.modality as any) ? study.studies[0]?.modality : undefined;
            if (volumeChartGrouping === 'service') return study.service;
            if (volumeChartGrouping === 'entidad') return study.patient.entidad || 'Desconocida';
            return undefined;
        };
        filteredStudies.forEach(study => {
            const key = getChartKey(study);
            if (key) dataMap.set(key, (dataMap.get(key) || 0) + 1);
        });
        return Array.from(dataMap.entries()).map(([name, total]) => ({ name, total })).sort((a,b) => b.total - a.total).slice(0, 10);
    }, [filteredStudies, volumeChartGrouping]);
    
    const cancellationData = useMemo(() => {
        const cancelledStudies = filteredStudies.filter(s => s.status === 'Cancelado');
        const reasonMap = new Map<string, number>();
        cancelledStudies.forEach(study => {
            const reason = study.cancellationReason || 'Sin motivo';
            reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
        });
        return Array.from(reasonMap.entries()).map(([name, value]) => ({ name, value }));
    }, [filteredStudies]);
    
    const handleSaveExpense = async (data: ExpenseFormData) => {
        const result = data.id ? await updateOperationalExpenseAction({ ...data, id: data.id }) : await addOperationalExpenseAction(data);
        if (result.success) toast({ title: `Gasto ${data.id ? 'actualizado' : 'añadido'}` });
        else toast({ variant: 'destructive', title: 'Error', description: result.error });
    };

    const handleDeleteExpense = async (id: string) => {
        const result = await deleteOperationalExpenseAction(id);
        if (result.success) toast({ title: 'Gasto Eliminado' });
        else toast({ variant: 'destructive', title: 'Error', description: result.error });
    };

    const handleCostUpdate = async () => {
        const result = await updateFinanceConfigAction(costPerVial);
        if (result.success) toast({ title: 'Costo actualizado' });
        else toast({ variant: 'destructive', title: 'Error', description: result.error });
    };

    if (authLoading || !userProfile || userProfile.rol !== 'administrador') {
        return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }
    
    return (
        <>
            <div className="container mx-auto py-6 space-y-6">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <h1 className="text-3xl font-bold font-headline tracking-tight">Estadísticas y Finanzas</h1>
                     <div className="flex flex-wrap gap-2">
                        <DateRangePicker date={dateRange} setDate={setDateRange} onApply={fetchData} />
                        <Select value={service} onValueChange={setService}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Servicio" /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos los Servicios</SelectItem>{GeneralServices.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                        <Select value={modality} onValueChange={setModality}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Modalidad" /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas las Modalidades</SelectItem>{Modalities.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
                    </div>
                </div>
                
                {!dateRange?.from ? (
                    <Card className="flex flex-col items-center justify-center py-20 text-center">
                        <CardHeader>
                            <CardTitle className="text-2xl font-headline">Seleccione un Rango de Fechas</CardTitle>
                            <CardDescription>Para comenzar, por favor elija un día o un rango de fechas en el selector de arriba.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <CalendarIcon className="h-16 w-16 text-muted-foreground" />
                        </CardContent>
                    </Card>
                ) : loading ? (
                     <div className="flex h-96 w-full items-center justify-center">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    </div>
                ) : (
                <>
                    <div className="flex flex-wrap gap-4">
                        <StatCard title="Gastos Totales" value={formatCurrency(monthlyTotal)} icon={DollarSign} loading={loading}/>
                        <StatCard title="Estudios Totales (Comp.)" value={kpis.totalStudies} icon={BarChart} loading={loading}/>
                        <StatCard title="T. de Oportunidad Prom." value={kpis.avgTurnaroundFormatted} icon={Hourglass} loading={loading}/>
                        <StatCard title="Estudios Contrastados" value={kpis.contrastStudies} icon={SyringeIcon} loading={loading}/>
                        <StatCard title="Tiempo en Cirugía (RX)" value={kpis.surgeryTimeFormatted} icon={Clock} loading={loading} />
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>Volumen de Estudios</CardTitle>
                                    <Select value={volumeChartGrouping} onValueChange={(v) => setVolumeChartGrouping(v as GroupingKey)}>
                                        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                                        <SelectContent><SelectItem value="modality">Por Modalidad</SelectItem><SelectItem value="service">Por Servicio</SelectItem><SelectItem value="entidad">Por EPS</SelectItem></SelectContent>
                                    </Select>
                                </div>
                            </CardHeader>
                            <CardContent>
                               <ResponsiveContainer width="100%" height={300}>
                                    {loading ? <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div> : volumeChartData.length > 0 ? (
                                        <RechartsBarChart data={volumeChartData} margin={{ top: 20, right: 20, left: -20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} /><YAxis fontSize={12} tickLine={false} axisLine={false} /><Tooltip />
                                            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}><LabelList dataKey="total" position="top" className="fill-foreground font-semibold" /></Bar>
                                        </RechartsBarChart>
                                    ) : <div className="flex items-center justify-center h-full text-muted-foreground">No hay datos para mostrar.</div>}
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader>
                                <CardTitle>Análisis de Contraste</CardTitle>
                                <CardDescription className="text-xs">Consumo de contraste del período.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 gap-4 flex-1">
                                <StatCard title="Facturado" value={contrastAnalysis.billed} icon={DollarSign} unit="ml"/>
                                <StatCard title="Administrado" value={contrastAnalysis.administered} icon={Droplets} unit="ml"/>
                                <StatCard title="Aprovechado" value={contrastAnalysis.remaining} icon={Beaker} unit="ml"/>
                                <div className="border-t pt-4 mt-2 space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="cost-vial" className="text-sm font-medium">Costo por Frasco (100ml)</Label>
                                        <div className="relative">
                                             <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input id="cost-vial" type="number" placeholder="0" className="pl-9" value={costPerVial || ''} onChange={(e) => setCostPerVial(Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={handleCostUpdate}/>
                                        </div>
                                    </div>
                                    <StatCard title="Ahorro Estimado" value={estimatedSavings} icon={DollarSign} formatFn={formatCurrency} />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Gastos Operativos</CardTitle>
                                <Button size="sm" onClick={() => { setEditingExpense(null); setIsExpenseDialogOpen(true); }}><Plus className="mr-2 h-4 w-4"/> Añadir</Button>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[26rem]"><Table><TableHeader><TableRow><TableHead>Desc.</TableHead><TableHead className="text-right">Monto</TableHead><TableHead className="w-[80px]">Acciones</TableHead></TableRow></TableHeader><TableBody>
                                {opExpenses.map((expense) => (<TableRow key={expense.id}><TableCell><p className="font-medium">{expense.description}</p><p className="text-xs text-muted-foreground">{expense.category} - {format(expense.date.toDate(), 'dd/MM/yy')}</p></TableCell><TableCell className="text-right font-semibold">{formatCurrency(expense.amount)}</TableCell><TableCell className="space-x-1"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingExpense(expense); setIsExpenseDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Confirmar eliminación?</AlertDialogTitle><AlertDialogDescription>Esta acción es irreversible.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteExpense(expense.id)}>Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></TableCell></TableRow>))}
                                </TableBody></Table>{opExpenses.length === 0 && <p className="text-center text-muted-foreground py-8">No hay gastos operativos.</p>}</ScrollArea>
                            </CardContent>
                        </Card>
                        <Card>
                             <CardHeader><div className="flex items-center gap-3"><Package className="h-6 w-6 text-primary" /><div><CardTitle>Insumos Comprados</CardTitle></div></div></CardHeader>
                            <CardContent>
                               <ScrollArea className="h-[26rem]"><Table><TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead className="text-right">Costo</TableHead></TableRow></TableHeader><TableBody>
                                {allSupplyEntries.map((entry) => (<TableRow key={entry.id}><TableCell><p className="font-medium">{entry.itemName}</p><p className="text-muted-foreground text-xs">{format(entry.date.toDate(), 'dd/MM/yy')} - {entry.amountAdded} x {formatCurrency(entry.priceAtEntry!)}</p></TableCell><TableCell className="text-right font-semibold">{formatCurrency(entry.cost)}</TableCell></TableRow>))}
                               </TableBody></Table>{allSupplyEntries.length === 0 && <p className="text-center text-muted-foreground py-8">No se compraron insumos.</p>}</ScrollArea>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Análisis de Cancelaciones</CardTitle>
                                <CardDescription>Motivos de cancelación de estudios.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    {loading ? <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div> : cancellationData.length > 0 ? (
                                        <RechartsPieChart>
                                            <Pie activeIndex={activeIndex} activeShape={renderActiveShape} data={cancellationData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} fill="#8884d8" dataKey="value" onMouseEnter={onPieEnter}>
                                                {cancellationData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                                            </Pie>
                                        </RechartsPieChart>
                                    ) : <div className="flex items-center justify-center h-full text-muted-foreground">No hay cancelaciones.</div>}
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </>
                )}
            </div>
            <ExpenseDialog open={isExpenseDialogOpen} onOpenChange={setIsExpenseDialogOpen} expense={editingExpense} onSave={handleSaveExpense}/>
        </>
    );
}

    
