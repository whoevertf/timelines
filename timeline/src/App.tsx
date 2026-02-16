import React from "react";
import "./App.css";
import { Timeline, type TimelineRow, type TimelineTask, type TaskStatus } from "./components/Timeline";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toIndex(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86400000);
}

function keyFromIndex(idx: number) {
  const ms = idx * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// smart create inside ONE row
function createTaskSmart(prev: TimelineTask[], clickDate: Date): TimelineTask[] {
  const defaultStatus: TaskStatus = "todo";
  const DEFAULT_LEN = 4;
  const clickKey = dayKey(clickDate);
  const clickIdx = toIndex(clickKey);

  const defaultTitle = "Новая задача"; // <-- заглушка

  const intervals = prev
    .map((t) => {
      const s = toIndex(t.startDayKey);
      return { s, e: s + t.lengthDays };
    })
    .sort((a, b) => a.s - b.s);

  const occupied = intervals.some((it) => clickIdx >= it.s && clickIdx < it.e);
  if (occupied) return prev;

  let prevEnd: number | null = null;
  let nextStart: number | null = null;

  for (const it of intervals) {
    if (it.e <= clickIdx) prevEnd = it.e;
    if (it.s > clickIdx) {
      nextStart = it.s;
      break;
    }
  }

  if (prevEnd !== null && nextStart !== null) {
    const gapLen = nextStart - prevEnd;
    if (gapLen >= 1 && gapLen <= 3 && clickIdx >= prevEnd && clickIdx < nextStart) {
      return [
        ...prev,
        { id: uid(), startDayKey: keyFromIndex(prevEnd), lengthDays: gapLen, title: defaultTitle, status: defaultStatus, },
      ];
    }
  }

  const availableToRight = nextStart === null ? DEFAULT_LEN : Math.max(0, nextStart - clickIdx);
  const len = Math.min(DEFAULT_LEN, availableToRight);

  if (len < 1) return prev;

  return [
    ...prev,
    { id: uid(), startDayKey: clickKey, lengthDays: len, title: defaultTitle, status: defaultStatus, },
  ];
}


export default function App() {
  const [centerDate, setCenterDate] = React.useState<Date>(() => startOfDay(new Date()));

  // start with one row
  const [rows, setRows] = React.useState<TimelineRow[]>(() => [
    { id: "row-1", tasks: [] },
    { id: "row-2", tasks: [] },
    { id: "row-3", tasks: [] },
    { id: "row-4", tasks: [] },
  ]);


  return (
    <div className="page">
      <main className="centerWrap">
        <section className="bigBlock" aria-label="Timeline workspace">
          <h1 className="title">Timeline</h1>
          <Timeline
            centerDate={centerDate}
            rangeDays={7}
            onShift={(delta) => setCenterDate((prev) => addDays(prev, delta))}
            onGoToday={() => setCenterDate(startOfDay(new Date()))}
            rows={rows}
            onCreateRow={() => {
              setRows((prev) => [
                ...prev,
                { id: `row-${prev.length + 1}-${uid()}`, tasks: [] },
              ]);
            }}
            onCreateTask={(rowId, startDate) => {
              setRows((prev) =>
                prev.map((r) =>
                  r.id === rowId ? { ...r, tasks: createTaskSmart(r.tasks, startDate) } : r
                )
              );
            }}
            onDeleteTask={(rowId, taskId) => {
              setRows((prev) =>
                prev.map((r) =>
                  r.id === rowId ? { ...r, tasks: r.tasks.filter((t) => t.id !== taskId) } : r
                )
              );
            }}
            onDeleteRow={(rowId) => {
              setRows((prev) => {
                // чтобы случайно не удалить последний ряд (безопаснее)
                if (prev.length <= 1) return prev;
                return prev.filter((r) => r.id !== rowId);
              });
            }}
            onResizeTask={(rowId, taskId, newStartDayKey, newLengthDays) => {
              let ok = false;

              setRows((prev) => {
                const row = prev.find((r) => r.id === rowId);
                const task = row?.tasks.find((t) => t.id === taskId);
                if (!row || !task) return prev;

                const newStart = toIndex(newStartDayKey);
                const newEnd = newStart + newLengthDays;

                // проверка пересечения с другими задачами в этом же ряду
                const intersects = row.tasks.some((t) => {
                  if (t.id === taskId) return false;
                  const s = toIndex(t.startDayKey);
                  const e = s + t.lengthDays;
                  return newStart < e && s < newEnd;
                });

                if (intersects) {
                  ok = false;
                  return prev;
                }

                ok = true;

                return prev.map((r) => {
                  if (r.id !== rowId) return r;
                  return {
                    ...r,
                    tasks: r.tasks.map((t) =>
                      t.id === taskId
                        ? { ...t, startDayKey: newStartDayKey, lengthDays: newLengthDays }
                        : t
                    ),
                  };
                });
              });

              return ok;
            }}
            onChangeStatus={(rowId, taskId, status) => {
              setRows((prev) =>
                prev.map((r) =>
                  r.id !== rowId
                    ? r
                    : {
                      ...r,
                      tasks: r.tasks.map((t) =>
                        t.id === taskId ? { ...t, status } : t
                      ),
                    }
                )
              );
            }}
            onRenameTask={(rowId, taskId, title) => {
              setRows((prev) =>
                prev.map((r) =>
                  r.id !== rowId
                    ? r
                    : { ...r, tasks: r.tasks.map((t) => (t.id === taskId ? { ...t, title } : t)) }
                )
              );
            }}
            onMoveTask={(fromRowId, taskId, toRowId, newStartDayKey) => {
              let movedOk = false;

              setRows((prev) => {
                const fromRow = prev.find((r) => r.id === fromRowId);
                const task = fromRow?.tasks.find((t) => t.id === taskId);
                if (!fromRow || !task) return prev;

                const newStartIdx = toIndex(newStartDayKey);
                const newEndIdx = newStartIdx + task.lengthDays;

                const next = prev.map((r) => {
                  // удаляем из исходного ряда
                  if (r.id === fromRowId) {
                    return { ...r, tasks: r.tasks.filter((t) => t.id !== taskId) };
                  }
                  return r;
                });

                // проверяем пересечение в целевом ряду
                const targetRow = next.find((r) => r.id === toRowId);
                if (!targetRow) return prev;

                const intervals = targetRow.tasks.map((t) => {
                  const s = toIndex(t.startDayKey);
                  return { s, e: s + t.lengthDays };
                });

                const intersects = intervals.some((it) => newStartIdx < it.e && it.s < newEndIdx);
                if (intersects) {
                  // конфликт — откатываем (возвращаем исходный prev)
                  movedOk = false;
                  return prev;
                }

                // вставляем в target
                const updatedTarget: TimelineTask = {
                  ...task,
                  startDayKey: newStartDayKey,
                };

                movedOk = true;

                return next.map((r) =>
                  r.id === toRowId ? { ...r, tasks: [...r.tasks, updatedTarget] } : r
                );
              });

              return movedOk;
            }}

          />
        </section>
      </main>
    </div>
  );
}
