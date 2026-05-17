"use client"

import { Copy, Printer, X } from "lucide-react"
import { toast } from "sonner"

import { MarkdownRenderer } from "@/components/markdown"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AnalysisResult } from "@/lib/types"

type AnalysisResultViewProps = {
  result: AnalysisResult
  onClose: () => void
}

function extractExecutiveSummary(masterReport: string) {
  const executiveSummaryMatch = masterReport.match(
    /(#+\s*(?:\d+\.?\s*)?(?:Y[öo]netici [ÖO]zeti|Executive Summary)[\s\S]*?)(?=\n#+\s|$)/i,
  )

  if (executiveSummaryMatch?.[1]) {
    return executiveSummaryMatch[1].trim()
  }

  return masterReport.slice(0, Math.max(600, Math.floor(masterReport.length * 0.25))).trim()
}

export function AnalysisResultView({ result, onClose }: AnalysisResultViewProps) {
  const masterReport = result.results.master_report || "Master rapor üretilemedi."
  const executiveSummary = extractExecutiveSummary(masterReport)

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(masterReport)
      toast.success("Rapor panoya kopyalandı.")
    } catch {
      toast.error("Rapor kopyalanamadı.")
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-blue-300/15 bg-[#05080d] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-300/80">Analiz Raporu</p>
          <h4 className="mt-2 text-xl font-semibold text-blue-100">{result.country_name} saha analizi</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={copyReport} className="text-blue-100">
            <Copy className="size-4" />
            Kopyala
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => window.print()} className="text-blue-100">
            <Printer className="size-4" />
            Yazdır
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="text-blue-100">
            <X className="size-4" />
            Kapat
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-blue-300/10 bg-blue-400/5 p-4 text-sm md:grid-cols-3 xl:grid-cols-6">
        <div>
          <p className="text-blue-100/45">Ülke</p>
          <p className="mt-1 font-semibold text-blue-100">{result.country_name}</p>
        </div>
        <div>
          <p className="text-blue-100/45">Koordinat</p>
          <p className="mt-1 font-mono text-blue-100">
            {result.coordinate.lat.toFixed(4)}, {result.coordinate.lon.toFixed(4)}
          </p>
        </div>
        <div>
          <p className="text-blue-100/45">Rakım</p>
          <p className="mt-1 font-mono text-blue-100">{result.coordinate.elevation.toFixed(1)} m</p>
        </div>
        <div>
          <p className="text-blue-100/45">Personel</p>
          <p className="mt-1 font-mono text-blue-100">{result.input.personnel_count}</p>
        </div>
        <div>
          <p className="text-blue-100/45">Süre</p>
          <p className="mt-1 font-mono text-blue-100">{result.processing_time_seconds.toFixed(1)} sn</p>
        </div>
        <div>
          <p className="text-blue-100/45">Veri profili</p>
          <p className="mt-1 text-blue-100">{result.input.data_profile}</p>
        </div>
      </div>

      <Tabs defaultValue="summary" className="mt-5">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl border border-blue-300/10 bg-black/20">
          <TabsTrigger value="summary">Yönetici Özeti</TabsTrigger>
          <TabsTrigger value="technical">Teknik Analiz</TabsTrigger>
          <TabsTrigger value="master">Master Rapor</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <ScrollArea className="max-h-[60vh] rounded-2xl border border-blue-300/10 bg-black/20 p-4">
            <MarkdownRenderer content={executiveSummary} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="technical" className="mt-4">
          <ScrollArea className="max-h-[60vh] rounded-2xl border border-blue-300/10 bg-black/20 p-4">
            <Accordion type="multiple" defaultValue={["regulation", "feasibility"]}>
              <AccordionItem value="regulation" className="border-blue-300/10">
                <AccordionTrigger className="text-blue-100 hover:text-blue-200">
                  Regülasyon ve Kapsama Analizi
                </AccordionTrigger>
                <AccordionContent>
                  <MarkdownRenderer content={result.results.regulation_and_coverage_analysis || "Rapor üretilemedi."} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="feasibility" className="border-blue-300/10">
                <AccordionTrigger className="text-blue-100 hover:text-blue-200">Fizibilite Raporu</AccordionTrigger>
                <AccordionContent>
                  <MarkdownRenderer content={result.results.feasibility_report || "Rapor üretilemedi."} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="master" className="mt-4">
          <ScrollArea className="max-h-[60vh] rounded-2xl border border-blue-300/10 bg-black/20 p-4">
            <MarkdownRenderer content={masterReport} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
