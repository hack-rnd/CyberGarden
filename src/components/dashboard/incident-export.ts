import ExcelJS from "exceljs";

import { summarizeActivity } from "./incident-analytics";
import {
  deadlineFor,
  isIncidentActive,
  type DashboardIncident,
  type IncidentTimelineEvent,
} from "./dashboard-model";
import { incidentGroups } from "./dashboard-summary";
import {
  formatDuration,
  priorityLabels,
  sortIncidentsForTable,
  statusLabels,
} from "./incident-views";

type ExportData = {
  incidents: readonly DashboardIncident[];
  tableIncidents: readonly DashboardIncident[];
  events?: readonly IncidentTimelineEvent[];
  criticalResolutions: ReadonlyMap<string, number | null>;
  exportedAt: number;
};

const UNASSIGNED_TEAM_LABELS = new Set([
  "",
  "не назначена",
  "не назначен",
  "не указан",
  "не указана",
]);

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "short",
});

const hourFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});

const chartWidth = 780;
const chartHeight = 350;

function formatAssignee(incident: DashboardIncident): string {
  const employee = incident.assigneeEmployee?.trim() || "";
  const rawTeam = incident.assigneeTeam?.trim() || "";
  const team = UNASSIGNED_TEAM_LABELS.has(rawTeam.toLowerCase()) ? "" : rawTeam;

  if (employee && team) return `${employee} · ${team}`;
  if (employee) return employee;
  if (team) return `Исполнитель не указан · ${team}`;
  return "Исполнитель не указан";
}

function createActivityChart(activity: ReturnType<typeof summarizeActivity>) {
  const canvas = document.createElement("canvas");
  canvas.width = chartWidth * 2;
  canvas.height = chartHeight * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить график Excel.");

  ctx.scale(2, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, chartWidth, chartHeight);
  ctx.strokeStyle = "#DFE3E8";
  ctx.strokeRect(0.5, 0.5, chartWidth - 1, chartHeight - 1);

  ctx.fillStyle = "#1D2023";
  ctx.font = "bold 21px Arial, sans-serif";
  ctx.fillText("Динамика инцидентов за 24 часа", 24, 35);
  ctx.fillStyle = "#5C6570";
  ctx.font = "13px Arial, sans-serif";
  ctx.fillText("Количество инцидентов · время по Москве", 24, 57);

  const series = [
    {
      key: "created" as const,
      label: "Создано",
      color: "#D9002B",
      dash: [],
      visible: activity.showCreated,
    },
    {
      key: "resolved" as const,
      label: "Решено и закрыто",
      color: "#007A62",
      dash: [6, 4],
      visible: activity.showResolved,
    },
  ].filter((line) => line.visible);

  if (!series.length) {
    ctx.fillText("Недостаточно данных для графика.", 24, 95);
    return canvas.toDataURL("image/png");
  }

  const plot = { left: 55, right: 746, top: 88, bottom: 267 };
  const max = Math.max(
    1,
    ...series.flatMap(({ key }) =>
      activity.buckets.map((bucket) => bucket[key]),
    ),
  );
  const tick = Math.ceil(max / 5);
  const ceiling = tick * Math.ceil(max / tick);
  const x = (index: number) =>
    plot.left +
    ((plot.right - plot.left) * index) / (activity.buckets.length - 1);
  const y = (value: number) =>
    plot.bottom - ((plot.bottom - plot.top) * value) / ceiling;

  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let value = 0; value <= ceiling; value += tick) {
    const row = y(value);
    ctx.strokeStyle = "#DFE3E8";
    ctx.beginPath();
    ctx.moveTo(plot.left, row);
    ctx.lineTo(plot.right, row);
    ctx.stroke();
    ctx.fillText(String(value), plot.left - 10, row);
  }

  ctx.textAlign = "center";
  activity.buckets.forEach((bucket, index) => {
    if (index % 4 === 0 || index === activity.buckets.length - 1) {
      ctx.fillText(hourFormat.format(bucket.start), x(index), plot.bottom + 17);
    }
  });

  series.forEach(({ key, color, dash, label }, lineIndex) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    activity.buckets.forEach((bucket, index) => {
      const height = y(bucket[key]);
      if (index === 0) ctx.moveTo(x(index), height);
      else ctx.lineTo(x(index), height);
    });
    ctx.stroke();

    const legendX = 24 + lineIndex * 145;
    ctx.beginPath();
    ctx.moveTo(legendX, 320);
    ctx.lineTo(legendX + 23, 320);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#1D2023";
    ctx.textAlign = "left";
    ctx.fillText(label, legendX + 31, 320);
  });

  return canvas.toDataURL("image/png");
}

function formatDate(timestamp: number) {
  return Number.isFinite(timestamp) ? dateFormat.format(timestamp) : null;
}

function slaValue(
  incident: DashboardIncident,
  exportedAt: number,
  resolvedAt?: number | null,
) {
  if (incident.status === "investigation") return "Этап RCA";
  const deadline = deadlineFor(incident);
  if (
    !isIncidentActive(incident) &&
    (resolvedAt == null || !Number.isFinite(deadline))
  ) {
    return "Завершён";
  }
  if (!Number.isFinite(deadline)) return "Срок не задан";
  const remaining = deadline - (resolvedAt ?? exportedAt);
  return remaining <= 0
    ? "Просрочен"
    : formatDuration(Math.ceil(remaining / 1000));
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1D2023" },
    };
    cell.alignment = { vertical: "middle" };
  });
}

export function createIncidentWorkbook({
  incidents,
  tableIncidents,
  events,
  criticalResolutions,
  exportedAt,
}: ExportData) {
  const workbook = new ExcelJS.Workbook();
  const activity = summarizeActivity({ incidents, events }, exportedAt);
  const analytics = workbook.addWorksheet("Аналитика");
  analytics.columns = [{ width: 32 }, { width: 24 }, { width: 24 }];
  styleHeader(analytics.addRow(["Аналитика за 24 часа", "Значение"]));
  analytics.addRows([
    ["Начало периода (МСК)", formatDate(activity.start)],
    ["Конец периода (МСК)", formatDate(activity.end)],
    ["Создано за 24ч", activity.showCreated ? activity.totalCreated : "Нет данных"],
    [
      "Решено и закрыто",
      activity.showResolved ? activity.totalResolved : "Нет данных",
    ],
    [
      "Критических решено",
      activity.showResolved ? activity.resolvedCriticalCount : "Нет данных",
    ],
    ["Активных с указанным SLA", activity.trackedSla],
    ["Просрочено SLA", activity.overdueSla],
    ["Соблюдение SLA", `${activity.slaCompliancePct}%`],
  ]);
  analytics.addRow([]);
  styleHeader(
    analytics.addRow(["Начало часа (МСК)", "Создано", "Решено и закрыто"]),
  );
  analytics.addRows(
    activity.buckets.map((bucket) => [
      formatDate(bucket.start),
      activity.showCreated ? bucket.created : null,
      activity.showResolved ? bucket.resolved : null,
    ]),
  );

  if (typeof document !== "undefined") {
    const imageId = workbook.addImage({
      base64: createActivityChart(activity),
      extension: "png",
    });
    analytics.addImage(imageId, {
      tl: { col: 4, row: 1 },
      ext: { width: chartWidth, height: chartHeight },
    });
  }

  const table = workbook.addWorksheet("Инциденты", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  table.columns = [
    { header: "ID", width: 27 },
    { header: "Продукт", width: 32 },
    { header: "Группы", width: 30 },
    { header: "Приоритет", width: 17 },
    { header: "Статус", width: 25 },
    { header: "Исполнитель", width: 48 },
    { header: "Создан (МСК)", width: 22 },
    { header: "Срок SLA (МСК)", width: 22 },
    { header: "До SLA", width: 18 },
    { header: "ИИ-риск", width: 13, style: { numFmt: "0%" } },
  ];

  const rows = sortIncidentsForTable(tableIncidents, criticalResolutions, exportedAt);
  table.addRows(
    rows.map((incident) => [
      incident.id,
      incident.product,
      incidentGroups
        .filter(({ id }) => incident.groups.includes(id))
        .map(({ title }) => title)
        .join(", "),
      priorityLabels[incident.priority],
      criticalResolutions.has(incident.id)
        ? "Критический решён"
        : statusLabels[incident.status],
      formatAssignee(incident),
      formatDate(Date.parse(incident.createdAt)),
      formatDate(Date.parse(incident.slaDeadline ?? "")),
      slaValue(incident, exportedAt, criticalResolutions.get(incident.id)),
      incident.ai ? incident.ai.riskScore / 100 : null,
    ]),
  );
  table.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rows.length + 1, column: table.columnCount },
  };
  styleHeader(table.getRow(1));

  return workbook;
}

export async function downloadIncidentWorkbook(
  data: Omit<ExportData, "exportedAt">,
) {
  const exportedAt = Date.now();
  const buffer = await createIncidentWorkbook({
    ...data,
    exportedAt,
  }).xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `incidents-${dateFormat.format(exportedAt).slice(0, 10)}.xlsx`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}