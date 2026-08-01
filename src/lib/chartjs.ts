import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
  type ChartOptions,
  type ScriptableContext,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
)

export const baseOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 } },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(148,163,184,0.15)' },
      ticks: { font: { size: 11 } },
    },
  },
}

export const gridLineColor = (context: ScriptableContext<'line' | 'bar'>) =>
  context.chart.options.plugins?.legend?.display ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.15)'

export default ChartJS
