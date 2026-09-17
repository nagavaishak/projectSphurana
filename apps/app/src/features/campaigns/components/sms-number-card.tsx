'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2Icon, MessageSquareIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import {
  type AvailableSmsNumber,
  smsNumberStatusLabels,
  useProvisionSmsNumber,
  useSearchSmsNumbers,
  useSmsNumber,
} from '../api';

/**
 * Set up / show the org's campaign SMS sender number. Search purchasable
 * Twilio numbers and buy one (gated behind an explicit confirm — it costs
 * money). Once active, SMS campaigns can launch.
 */
export function SmsNumberCard() {
  const { smsNumber, isLoading } = useSmsNumber();
  const [country, setCountry] = useState('US');
  const [areaCode, setAreaCode] = useState('');
  const { search, results, isSearching } = useSearchSmsNumbers();
  const { provision, isProvisioning } = useProvisionSmsNumber();

  if (isLoading) return <Skeleton className="h-28 w-full" />;

  if (smsNumber && smsNumber.status === 'active') {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareIcon className="size-4" /> SMS sending
            </CardTitle>
            <Badge className="gap-1">
              <CheckCircle2Icon className="size-3" />
              {smsNumberStatusLabels[smsNumber.status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Campaigns send SMS from{' '}
          <span className="font-medium text-foreground">
            {smsNumber.phoneNumber}
          </span>{' '}
          ({smsNumber.country}).
        </CardContent>
      </Card>
    );
  }

  const trimmedCountry = country.trim().toUpperCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareIcon className="size-4" /> Set up SMS sending
        </CardTitle>
        <CardDescription>
          Buy a local number so you can text your leads. It’s billed to your
          Twilio account (a small monthly cost).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sms-country">Country</Label>
            <Input
              id="sms-country"
              value={country}
              onChange={(e) => setCountry(e.target.value.slice(0, 2))}
              placeholder="US"
              className="w-20 uppercase"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sms-area">Area code (optional)</Label>
            <Input
              id="sms-area"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
              placeholder="415"
              className="w-28"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isSearching || trimmedCountry.length !== 2}
            onClick={() =>
              search({
                country: trimmedCountry,
                areaCode: areaCode.trim() || undefined,
              })
            }
          >
            <SearchIcon className="size-4" />
            {isSearching ? 'Searching…' : 'Find numbers'}
          </Button>
        </div>

        {results.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {results.map((n: AvailableSmsNumber) => (
              <li
                key={n.phoneNumber}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span>
                  <span className="font-medium">{n.phoneNumber}</span>
                  {(n.locality || n.region) && (
                    <span className="text-muted-foreground">
                      {' '}
                      — {[n.locality, n.region].filter(Boolean).join(', ')}
                    </span>
                  )}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" disabled={isProvisioning}>
                      Buy
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Buy {n.phoneNumber}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This purchases the number on your Twilio account (a
                        recurring monthly charge) and sets it as your campaign
                        SMS sender. You can send SMS campaigns right after.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          provision({
                            country: trimmedCountry,
                            phoneNumber: n.phoneNumber,
                          })
                        }
                      >
                        Buy number
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
