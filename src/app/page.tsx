"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AppLogoIcon } from '@/components/icons/app-logo-icon';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center items-center mb-4">
            <AppLogoIcon className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="font-headline text-3xl">¡Bienvenido a Med-iTrack!</CardTitle>
          <CardDescription>La aplicación está lista. Accede para empezar a gestionar las solicitudes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg">
            <Link href="/login">Acceder</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
