import { Bar, Doughnut, Line } from 'react-chartjs-2'
import type { ChartData, ChartOptions } from 'chart.js'
import '@/lib/chartjs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const palette = {
  blue: 'hsl(217 91% 60%)',
  sky: 'hsl(199 89% 48%)',
  emerald: 'hsl(160 84% 39%)',
  amber: 'hsl(38 92% 50%)',
  rose: 'hsl(0 72% 51%)',
  violet: 'hsl(263 70% 50%)',
  slate: 'hsl(215 20% 65%)',
}

interface ChartCardProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function ChartCard({ title, description, children, className }: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  )
}

const baseScaleOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { font: { size: 11 } } },
  },
}

export function BarChart({ data }: { data: ChartData<'bar'> }) {
  return <Bar data={data} options={baseScaleOptions} />
}

export function LineChart({ data }: { data: ChartData<'line'> }) {
  return <Line data={data} options={baseScaleOptions as unknown as ChartOptions<'line'>} />
}

export function DoughnutChart({ data }: { data: ChartData<'doughnut'> }) {
  return (
    <Doughnut
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        },
      }}
    />
  )
}

export { palette }
