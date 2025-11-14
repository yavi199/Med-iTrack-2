
"use client";

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from '../ui/scroll-area';

interface AssignOperatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  operators: string[];
  onAssign: (operator: string) => void;
}

export function AssignOperatorDialog({
  open,
  onOpenChange,
  title,
  description,
  operators,
  onAssign,
}: AssignOperatorDialogProps) {
  const [selectedOperator, setSelectedOperator] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selectedOperator) {
      onAssign(selectedOperator);
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ScrollArea className="max-h-60 w-full rounded-md border p-4">
          <RadioGroup
            value={selectedOperator ?? undefined}
            onValueChange={setSelectedOperator}
            className="flex flex-col gap-3"
          >
            {operators.length > 0 ? operators.map((op) => (
              <div key={op} className="flex items-center space-x-3">
                <RadioGroupItem value={op} id={`op-${op}`} />
                <Label htmlFor={`op-${op}`} className="text-base font-medium w-full cursor-pointer">
                  {op}
                </Label>
              </div>
            )) : <p className="text-sm text-muted-foreground text-center">No hay operadores registrados para este rol.</p>}
          </RadioGroup>
        </ScrollArea>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!selectedOperator}>
            Asignar Turno
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
