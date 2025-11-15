
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AppLogoIcon } from '@/components/icons/app-logo-icon';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { useEffect } from 'react';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/imaging');
      } else {
        router.push('/login');
      }
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center items-center mb-4">
            <AppLogoIcon className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="font-headline text-3xl">¡Bienvenido a Med-iTrack!</CardTitle>
          <CardDescription>Redirigiendo...</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Serás redirigido en un momento.</p>
        </CardContent>
      </Card>
    </div>
  );
}
