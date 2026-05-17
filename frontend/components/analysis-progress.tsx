"use client"

import { AlertTriangle, Check, FileText, Globe, Loader2, Shield, Wrench } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { AnalysisProgress as AnalysisProgressType, AnalysisStatus } from "@/lib/types"

type AnalysisProgressProps = {
  status: Exclude<AnalysisStatus, "idle">
  logs: string[]
  progress: Pick<AnalysisProgressType, "step" | "message"> | null
  elapsed: number
  error: string | null
  onCancel?: () => void
}

const steps = [
  { title: "Konum Doğrulanıyor", icon: Globe },
  { title: "Regülasyon Analizi", icon: Shield },
  { title: "Fizibilite Hesaplaması", icon: Wrench },
  { title: "Rapor Oluşturuluyor", icon: FileText },
]

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
}

function getProgressValue(status: AnalysisStatus, step: number | null) {
  if (status === "completed") {
    return 100
  }
  if (status === "error") {
    return 100
  }
  if (step === 0) {
    return 10
  }
  if (step === 1) {
    return 35
  }
  if (step === 2) {
    return 65
  }
  if (step === 3) {
    return 90
  }
  return 5
}

export function AnalysisProgress({
  status,
  logs,
  progress,
  elapsed,
  error,
  onCancel,
}: AnalysisProgressProps) {
  const activeStep = progress?.step ?? 0
  const canCancel = status === "connecting" || status === "streaming"
  const progressValue = getProgressValue(status, progress?.step ?? null)

  return (
    <div className="mt-5 rounded-2xl border border-blue-300/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-100">
            {progress?.message ?? (status === "connecting" ? "Backend bağlantısı kuruluyor" : "Analiz bekleniyor")}
          </p>
          <p className="mt-1 font-mono text-xs text-blue-100/55">Geçen süre: {formatElapsed(elapsed)}</p>
        </div>
        {canCancel && onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="border-red-300/20 text-red-100 hover:border-red-300/40 hover:bg-red-500/10"
          >
            İptal Et
          </Button>
        )}
      </div>

      <Progress value={progressValue} className="mt-4 bg-blue-950/60 [&_[data-slot=progress-indicator]]:bg-[oklch(0.62_0.12_240)]" />

      <div className="mt-5 space-y-0">
        {steps.map((step, index) => {
          const Icon = step.icon
          const isDone = status === "completed" || index < activeStep
          const isActive = status !== "completed" && status !== "error" && index === activeStep

          return (
            <div key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    "absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-blue-300/10",
                    isDone && "bg-[oklch(0.62_0.12_240)]/60",
                  )}
                />
              )}
              <div
                className={cn(
                  "relative z-10 flex size-8 items-center justify-center rounded-full border border-blue-300/10 bg-[#05080d] text-blue-100/35",
                  isActive && "border-blue-300/40 text-[oklch(0.72_0.12_240)] shadow-[0_0_20px_rgba(64,156,255,0.24)]",
                  isDone && "border-emerald-300/30 text-emerald-300",
                )}
              >
                {isDone ? (
                  <Check className="size-4" />
                ) : isActive ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )}
              </div>
              <div className="min-w-0 pt-1">
                <p className={cn("text-sm font-medium text-blue-100/45", (isActive || isDone) && "text-blue-100")}>
                  {step.title}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {logs.length > 0 && (
        <ScrollArea className="mt-4 h-36 rounded-xl border border-blue-300/10 bg-[#02050a] p-3">
          <div className="space-y-2">
            {[...logs].reverse().map((logEntry, index) => (
              <p key={`${logEntry}-${index}`} className="font-mono text-xs leading-5 text-blue-100/65">
                {logEntry}
              </p>
            ))}
          </div>
        </ScrollArea>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4 border-red-400/30 bg-red-500/10 text-red-100">
          <AlertTriangle className="size-4" />
          <AlertTitle>Analiz Hatası</AlertTitle>
          <AlertDescription className="text-red-100/80">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
