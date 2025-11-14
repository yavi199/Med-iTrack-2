
"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalityIcon } from '../icons/modality-icon';

type ViewMode = 'imaging' | 'consultations';

interface ViewModeSwitchProps {
    activeView: ViewMode;
}

export function ViewModeSwitch({ activeView }: ViewModeSwitchProps) {
    const router = useRouter();

    const handleSwitch = (newView: ViewMode) => {
        if (newView !== activeView) {
            router.push(`/${newView}`);
        }
    };

    return (
        <div className="flex items-center gap-1 rounded-full bg-muted p-1">
            <Button 
                size="icon" 
                variant={activeView === 'imaging' ? 'default' : 'ghost'}
                className={cn("rounded-full h-8 w-8", activeView === 'imaging' && "shadow-md")}
                onClick={() => handleSwitch('imaging')}
            >
                <ModalityIcon className="h-5 w-5" />
            </Button>
            <Button 
                size="icon" 
                variant={activeView === 'consultations' ? 'default' : 'ghost'}
                className={cn("rounded-full h-8 w-8", activeView === 'consultations' && "shadow-md")}
                onClick={() => handleSwitch('consultations')}
            >
                <Stethoscope className="h-5 w-5" />
            </Button>
        </div>
    );
}
