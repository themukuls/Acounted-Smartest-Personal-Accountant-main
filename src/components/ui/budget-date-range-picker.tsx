import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface BudgetDateRange {
  startDate: Date;
  endDate: Date;
}

interface BudgetDateRangePickerProps {
  value: BudgetDateRange;
  onChange: (range: BudgetDateRange) => void;
  className?: string;
}

export function BudgetDateRangePicker({ value, onChange, className }: BudgetDateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStartDate, setSelectedStartDate] = useState<Date | undefined>(value.startDate);

  const handleStartDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedStartDate(date);
      // Auto-set end date to one month later
      const endDate = new Date(date);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(endDate.getDate() - 1); // Last day of the budget period
      
      onChange({
        startDate: date,
        endDate: endDate
      });
      setIsOpen(false);
    }
  };

  const formatDateRange = () => {
    if (!value.startDate || !value.endDate) return "Select budget period";
    
    const start = format(value.startDate, "MMM dd");
    const end = format(value.endDate, "MMM dd, yyyy");
    
    return `${start} - ${end}`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-64 justify-start text-left font-normal glass-input",
            !value.startDate && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDateRange()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4">
          <div className="text-sm font-medium mb-3">Select Budget Start Date</div>
          <Calendar
            mode="single"
            selected={selectedStartDate}
            onSelect={handleStartDateSelect}
            initialFocus
          />
          <div className="text-xs text-muted-foreground mt-2">
            Budget period will be one month from selected date
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}