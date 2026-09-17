'use client';

/**
 * §5.4 — what a clinical product record still lacks.
 *
 * ## The correction that produced this screen
 *
 * The first version of this wireframe drew a products LIST with a four-field
 * dialog over it, on the stated premise that the live settings page "has a name
 * and a supplier and nothing else". That premise was false. `use-product-editor`
 * ships twenty-two fields across four tabs — Details, Pricing, Identifiers,
 * Stock — with a photo uploader in the aside. Proposing a list page and a
 * four-field dialog would have replaced a richer editor with a poorer one.
 *
 * So this is not a page. It is the two gaps that remain, drawn where they land.
 *
 * ## Gap 1 — a lot number is not a product field
 *
 * There is no lot or batch column anywhere in the schema. It is tempting to add
 * one to `product`, which would be wrong: a lot is a property of the vial in
 * the fridge, not of "Botox". The same product passes through many lots, and
 * the number has to be recoverable per PATIENT for a recall. So it is captured
 * at administration, on the face-map pin, and the only product-level control is
 * whether capture is required.
 *
 * ## Gap 2 — the measure enum cannot express a unit of toxin
 *
 * `productMeasureUnit` offers ml, l, fl_oz, g, kg, gal, oz, lb, cm, ft, in and
 * whole. Botulinum toxin is dosed in UNITS, which is not among them and is not
 * a volume — 50 units reconstituted into 2.5ml is still 50 units. Recording it
 * as `whole` or as ml both lose the number a practitioner actually charts.
 */

import { AlertTriangleIcon } from 'lucide-react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { WfFrame, WfPoint } from '../wf-frame';

/** The live editor's tabs, reproduced as inert context. */
const EDITOR_TABS = ['Details', 'Pricing', 'Identifiers', 'Stock'];

export function WfProducts() {
  return (
    <WfFrame
      name="Product — clinical fields"
      location="Settings › Products › edit › Stock (existing editor)"
      notes={
        <>
          <WfPoint title="The editor already exists">
            Twenty-two fields across four tabs ship today. Nothing here replaces
            them — this is one switch added to the Stock tab, drawn in place.
          </WfPoint>
          <WfPoint title="Lot numbers belong to the administration, not the product">
            One product passes through many lots. Storing the lot on `product`
            would overwrite the previous one and make a recall unanswerable. The
            switch here only decides whether the face-map pin demands it.
          </WfPoint>
          <WfPoint title="The measure enum has no unit of toxin">
            Twelve units of measure, all volume, weight or length. Toxin is
            dosed in units, which is none of those. Needs a schema decision
            before the pin tool can chart a dose.
          </WfPoint>
        </>
      }
    >
      <DashboardPage title="Botox 100u" description="Allergan · Injectables">
        <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
          {EDITOR_TABS.map((t) => (
            <span
              key={t}
              className={
                t === 'Stock'
                  ? 'rounded-md bg-background px-3 py-1.5 font-medium text-foreground text-sm shadow-sm'
                  : 'rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm'
              }
            >
              {t}
            </span>
          ))}
        </div>

        <div className="mt-6 max-w-2xl space-y-6">
          {/* Existing controls, greyed to read as context. */}
          <div className="space-y-4 opacity-60">
            {['Track stock', 'Low stock alerts'].map((label) => (
              <div key={label} className="flex items-center justify-between">
                <Label className="font-normal">{label}</Label>
                <Switch defaultChecked />
              </div>
            ))}
          </div>

          {/* The delta. */}
          <div className="space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-5">
            <Badge variant="outline" className="border-primary/40">
              New
            </Badge>

            <div className="flex items-start justify-between gap-6">
              <div>
                <Label className="font-normal">Require a lot number</Label>
                <p className="mt-1 text-muted-foreground text-sm">
                  The practitioner must enter the batch on the vial each time
                  this product is recorded against a patient.
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="border-t pt-4">
              <Label className="font-normal">Dose unit</Label>
              <Select defaultValue="whole">
                <SelectTrigger className="mt-2 w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ml">Millilitres</SelectItem>
                  <SelectItem value="whole">Whole item</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 flex items-start gap-2 text-amber-700 text-sm dark:text-amber-400">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                Toxin is dosed in units. The enum has no such value, so this
                product cannot record “24 units” without a schema change.
              </p>
            </div>
          </div>
        </div>
      </DashboardPage>
    </WfFrame>
  );
}
