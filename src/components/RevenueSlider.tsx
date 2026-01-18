import { Euro } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { 
  REVENUE_THRESHOLDS, 
  REVENUE_FLOOR, 
  getSliderIndex, 
  getValueFromSliderIndex,
  formatRevenue 
} from '@/hooks/useRevenueSettings';

interface RevenueSliderProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function RevenueSlider({ 
  value, 
  onChange, 
  label = "Chiffre d'affaires minimum",
  description,
  disabled = false 
}: RevenueSliderProps) {
  const sliderIndex = getSliderIndex(value);
  
  const handleSliderChange = (values: number[]) => {
    const newValue = getValueFromSliderIndex(values[0]);
    onChange(newValue);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Euro className="h-4 w-4 text-emerald-500" />
          {label}
        </Label>
        <Badge 
          variant="secondary" 
          className="text-base px-3 font-mono bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          {formatRevenue(value)}
        </Badge>
      </div>
      
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      
      <Slider
        value={[sliderIndex]}
        onValueChange={handleSliderChange}
        min={0}
        max={REVENUE_THRESHOLDS.length - 1}
        step={1}
        disabled={disabled}
        className="w-full"
      />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatRevenue(REVENUE_FLOOR)}</span>
        <span className="text-center opacity-60">Plancher: 1M€ à la création</span>
        <span>{formatRevenue(REVENUE_THRESHOLDS[REVENUE_THRESHOLDS.length - 1].value)}</span>
      </div>
    </div>
  );
}
