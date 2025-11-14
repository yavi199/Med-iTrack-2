
"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { es } from 'date-fns/locale';
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps extends React.ComponentProps<"div"> {
    date: DateRange | undefined;
    setDate: (date: DateRange | undefined) => void;
    onApply?: (date: DateRange | undefined) => void;
    triggerClassName?: string;
    align?: "start" | "center" | "end";
    showMonths?: 1 | 2;
}

export function DateRangePicker({ className, date, setDate, onApply, triggerClassName, align = "center", showMonths = 2 }: DateRangePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [localDate, setLocalDate] = React.useState<DateRange | undefined>(date);
    
    React.useEffect(() => {
        setLocalDate(date);
    }, [date]);

    const handleApply = () => {
        setDate(localDate);
        if (onApply) {
            onApply(localDate);
        }
        setIsOpen(false);
    };

    const handleCancel = () => {
        setLocalDate(date);
        setIsOpen(false);
    };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
              triggerClassName
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y", { locale: es })} -{" "}
                  {format(date.to, "LLL dd, y", { locale: es })}
                </>
              ) : (
                format(date.from, "LLL dd, y", { locale: es })
              )
            ) : (
              <span>Fecha</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={localDate?.from}
            selected={localDate}
            onSelect={setLocalDate}
            numberOfMonths={showMonths}
            locale={es}
          />
          <div className="flex justify-end gap-2 p-2 border-t">
              <Button variant="ghost" onClick={handleCancel}>Cancelar</Button>
              <Button onClick={handleApply} disabled={!localDate?.from}>Aplicar</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
