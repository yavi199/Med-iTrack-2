
"use client";

import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRight, Stethoscope } from "lucide-react";
import Link from 'next/link';
import { ModalityIcon } from "@/components/icons/modality-icon";
import { AppLogoIcon } from "@/components/icons/app-logo-icon";
import React, { useEffect } from 'react';
import { useAuth } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { AuthLoader } from "@/context/auth-context";

const modules = [
    {
        href: "/imaging",
        icon: ModalityIcon,
        title: "Imágenes Diagnósticas",
        description: "Gestión de estudios de Rayos X, Tomografías, Ecografías y Resonancias.",
        color: "text-yellow-500",
        hoverColor: "hover:border-yellow-500"
    },
    {
        href: "/consultations",
        icon: Stethoscope,
        title: "Interconsultas",
        description: "Seguimiento de solicitudes de consulta con especialistas médicos.",
        color: "text-blue-600",
        hoverColor: "hover:border-blue-600"
    }
];

function ModuleSelectionContent() {
    const { user, loading, userProfile, currentProfile } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading) {
            if (!user) {
                router.push('/login');
            } else if (currentProfile?.rol === 'tecnologo' || currentProfile?.rol === 'transcriptora') {
                router.push('/imaging');
            } else if (currentProfile?.rol === 'enfermero' && currentProfile?.servicioAsignado === 'URG') {
                router.push('/clinical-assistant-view');
            }
        }
    }, [user, loading, router, currentProfile]);
    
    if (loading || !user || currentProfile?.rol === 'tecnologo' || currentProfile?.rol === 'transcriptora' || (currentProfile?.rol === 'enfermero' && currentProfile?.servicioAsignado === 'URG')) {
        return <AuthLoader />;
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
             <div className="absolute top-8 left-8">
                <Link href="/" className="flex items-center gap-3">
                    <AppLogoIcon className="h-8 w-8 text-primary" />
                     <div>
                        <h1 className="text-xl font-bold font-headline tracking-tight">Med-iTrack</h1>
                     </div>
                </Link>
            </div>
            <div className="text-center mb-12">
                <h1 className="text-4xl font-bold font-headline tracking-tight">Bienvenido, {currentProfile?.nombre}</h1>
                <p className="text-xl text-muted-foreground mt-2">Por favor, selecciona un módulo para comenzar a trabajar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
                {modules.map((module) => (
                    <Link href={module.href} key={module.title} className={`group ${module.color}`}>
                        <Card className={`p-8 h-full flex flex-col justify-between ${module.hoverColor} hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1`}>
                            <div>
                                <module.icon className={`h-12 w-12 ${module.color} mb-4`} />
                                <CardTitle className="font-headline text-2xl mb-2 text-foreground">{module.title}</CardTitle>
                                <CardDescription>{module.description}</CardDescription>
                            </div>
                            <div className={`flex items-center ${module.color} font-semibold mt-6 opacity-0 group-hover:opacity-100 transition-opacity`}>
                                <span>Acceder al Módulo</span>
                                <ArrowRight className="ml-2 h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
                            </div>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}

export default function ModuleSelectionPage() {
    return (
        <AuthLoader>
            <ModuleSelectionContent />
        </AuthLoader>
    );
}
