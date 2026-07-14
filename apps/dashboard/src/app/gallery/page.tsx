'use client';

// Interim component gallery: renders every primitive + variant against the design
// reference so the library can be eyeballed in light and dark. Not a product route.
import { ThemeToggle } from '@/components/theme-toggle';
import { AIPanel } from '@/components/ui/ai-panel';
import { Banner } from '@/components/ui/banner';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldRow } from '@/components/ui/field-row';
import { Fresh } from '@/components/ui/fresh';
import { IdentityChip } from '@/components/ui/identity-chip';
import { Input } from '@/components/ui/input';
import { LiveDot } from '@/components/ui/live-dot';
import { Mismatch } from '@/components/ui/mismatch';
import { Pill } from '@/components/ui/pill';
import { Power } from '@/components/ui/power';
import { Section as KvSection } from '@/components/ui/section';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatePill } from '@/components/ui/state-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { VoteTag } from '@/components/ui/vote-tag';

const MIN = 60_000;
const HOUR = 3_600_000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function GalleryPage() {
  return (
    <TooltipProvider>
      <main className="min-h-screen space-y-8 bg-bg p-8 text-ink">
        <header className="flex items-center justify-between border-b border-line pb-4">
          <h1 className="font-mono text-h1">Component gallery</h1>
          <ThemeToggle />
        </header>

        <Section title="Button">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </Section>

        <Section title="Form controls">
          <Input placeholder="0x address or ENS…" className="max-w-xs" />
          <Select>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue placeholder="Select a DAO" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compound">Compound</SelectItem>
              <SelectItem value="uniswap">Uniswap</SelectItem>
              <SelectItem value="aave">Aave</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Rationale…" className="max-w-xs" />
        </Section>

        <Section title="Pill / DAO swatches">
          <Pill>proposal</Pill>
          <Pill dao="compound">Compound</Pill>
          <Pill dao="uniswap">Uniswap</Pill>
          <Pill dao="aave">Aave</Pill>
          <Pill dao="arb">Arbitrum</Pill>
        </Section>

        <Section title="StatePill">
          <StatePill state="active">active</StatePill>
          <StatePill state="passed">passed</StatePill>
          <StatePill state="executed">executed</StatePill>
          <StatePill state="defeated">defeated</StatePill>
          <StatePill state="queued">queued</StatePill>
          <StatePill state="draft">draft</StatePill>
        </Section>

        <Section title="VoteTag">
          <VoteTag choice="for">for</VoteTag>
          <VoteTag choice="against">against</VoteTag>
          <VoteTag choice="abstain">abstain</VoteTag>
        </Section>

        <Section title="Banner">
          <div className="w-full max-w-2xl space-y-2">
            <Banner severity="warn" glyph="!">
              <b>Material mismatch.</b> On-chain outcome differs from the forum consensus.
            </Banner>
            <Banner severity="note" glyph="?">
              <b>Queued.</b> Awaiting timelock before execution.
            </Banner>
            <Banner severity="ok" glyph="✓">
              <b>Consistent.</b> Outcome matches the discussion.
            </Banner>
          </div>
        </Section>

        <Section title="Card">
          <Card className="w-64">
            <CardHeader>Overview</CardHeader>
            <CardContent className="font-mono text-small text-ink-2">
              Standard card surface.
            </CardContent>
          </Card>
          <Card flagged className="w-64">
            <CardHeader flagged>Flagged</CardHeader>
            <CardContent className="font-mono text-small text-ink-2">
              Audit flag treatment.
            </CardContent>
          </Card>
        </Section>

        <Section title="Table">
          <div className="w-full max-w-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voter</TableHead>
                  <TableHead>Choice</TableHead>
                  <TableHead className="text-right">Power</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>0x1a2b…3c4d</TableCell>
                  <TableCell>
                    <VoteTag choice="for">for</VoteTag>
                  </TableCell>
                  <TableCell className="text-right">1,234,567</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>0x5e6f…7a8b</TableCell>
                  <TableCell>
                    <VoteTag choice="against">against</VoteTag>
                  </TableCell>
                  <TableCell className="text-right">89,012</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="summary" className="w-full max-w-xl">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="voters">Voters</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="font-mono text-small text-ink-2">
              Summary tab content.
            </TabsContent>
            <TabsContent value="actions" className="font-mono text-small text-ink-2">
              Actions tab content.
            </TabsContent>
            <TabsContent value="voters" className="font-mono text-small text-ink-2">
              Voters tab content.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Breadcrumb">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">DAOs</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Compound</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Proposal 245</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Section>

        <Section title="Segmented">
          <Segmented type="single" defaultValue="30d" aria-label="Range">
            <SegmentedItem value="7d">7d</SegmentedItem>
            <SegmentedItem value="30d">30d</SegmentedItem>
            <SegmentedItem value="90d">90d</SegmentedItem>
          </Segmented>
        </Section>

        <Section title="IdentityChip">
          <IdentityChip address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b" name="vitalik.eth" />
          <IdentityChip address="0x9c0d1e2f3a4b5c6d7e8f9a0b1a2b3c4d5e6f7a8b" />
        </Section>

        <Section title="Skeleton">
          <div className="w-full max-w-sm space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        </Section>

        <Section title="Overlays">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect wallet</DialogTitle>
                <DialogDescription>Sign in with Ethereum to manage your keys.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button>Continue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Slide-over drawer (mobile nav chrome).</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Active</DropdownMenuItem>
              <DropdownMenuItem>Passed</DropdownMenuItem>
              <DropdownMenuItem>Defeated</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Reference block 21,000,000</TooltipContent>
          </Tooltip>
        </Section>

        <Section title="Section / FieldRow">
          <div className="w-full max-w-2xl">
            <KvSection number="01" title="Decoded actions" reference="Ethereum · block 21,000,000">
              <div className="border border-line-3 bg-bg-2">
                <FieldRow label="target">0x6b17…1d0f</FieldRow>
                <FieldRow label="function">transfer(address,uint256)</FieldRow>
                <FieldRow label="value">1,000,000 USDC</FieldRow>
              </div>
            </KvSection>
          </div>
        </Section>

        <Section title="AIPanel — states">
          <div className="w-full max-w-2xl space-y-4">
            <AIPanel
              provenance={{
                model: 'claude-sonnet',
                promptVersion: 'v3',
                generatedAt: Date.now() - 5 * MIN,
                inputHref: '#',
              }}
              sourceHref="#"
              confidence="high"
            >
              <p>
                This proposal renews the safety-module budget for another six months at the current
                emission rate, with no change to the reward token.
              </p>
            </AIPanel>
            <AIPanel state="loading" provenance={{ model: 'claude-sonnet' }} />
            <AIPanel
              state="stale"
              provenance={{ model: 'claude-sonnet', generatedAt: Date.now() - 3 * HOUR }}
              sourceHref="#"
            >
              <p>Last-good summary retained while the inputs changed.</p>
            </AIPanel>
            <AIPanel state="rate-limited" provenance={{ model: 'claude-sonnet' }} sourceHref="#" />
            <AIPanel
              state="failed"
              provenance={{ model: 'claude-sonnet' }}
              fallbackHref="#"
              sourceHref="#"
              confidence="low"
            />
          </div>
        </Section>

        <Section title="Mismatch / Power / Fresh / LiveDot">
          <Mismatch
            severity="material"
            summary="Calldata sends to a different treasury than the prose states."
            href="#"
          />
          <Mismatch
            severity="severe"
            summary="Recipient address is not mentioned anywhere in the proposal."
            href="#"
          />
          <Power
            value={1234567}
            unit="COMP"
            referenceBlock={21000000}
            composition={{ delegatedIn: 900000, self: 334567, total: 1234567 }}
          />
          <span className="inline-flex items-center gap-2">
            <LiveDot live />
            <Fresh timestamp={Date.now() - 8000} />
          </span>
        </Section>

        <Section title="IdentityChip (scorecard link)">
          <IdentityChip
            address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
            name="vitalik.eth"
            scorecardHref="#"
          />
        </Section>
      </main>
    </TooltipProvider>
  );
}
