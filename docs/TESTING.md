# Hermes Mobile — แผนทดสอบ (Manual Test Plan)

เอกสารนี้สรุปวิธีทดสอบการแก้บั๊กชุดล่าสุด (session-state leaks + WS event cross-talk)
ใช้คู่กับ commit:

| Commit | เนื้อหา |
| --- | --- |
| `9c41242` | Fix session-state leaks and WS event cross-talk |
| `89447b4` | Guard `stop()` against a stuck turn and filter all session events |

`BUILD_ID` ล่าสุด: `2026-09-24#47-ask-inbox` (ดูได้ที่หน้า Login / Settings)

---

## 0. สิ่งที่ต้องเตรียม

- Dev build (หรือ APK preview) ที่มีโค้ดล่าสุด — ตรวจ `BUILD_ID` ว่าเป็น `#47` ขึ้นไป
- Gateway (dashboard) ที่ต่อได้ + บัญชีที่ login ผ่าน
- อุปกรณ์/เครื่องที่ 2 หรือ terminal สำหรับสั่งงานเบื้องหลัง (cron / แชทอีกเซสชัน)
- ทางเลือกเสริม: เปิด Metro log เพื่อดู console

> ลำดับความสำคัญ: กลุ่ม A (session filtering) สำคัญสุด เพราะถ้าพลาด แชทจะดูเหมือนค้าง
> ส่วนกลุ่ม B–G เป็นการเช็คฟีเจอร์ที่แก้

---

## กลุ่ม A — Session filtering (ความเสี่ยงสูงสุด) 🔴

### A1. เช็คว่าของเดิมไม่พัง (regression — สำคัญสุด)

| | |
| --- | --- |
| **ขั้นตอน** | 1) เปิดแชท → ส่งข้อความสั้น ๆ เช่น `สวัสดี`<br>2) รอให้ agent ตอบ |
| **คาดหวัง** | ข้อความ stream ขึ้นทีละ token, tool card (ถ้ามี) ขึ้น, พอจบเทิร์น bubble หยุด `pending` และพิมพ์ต่อได้ |
| **ถ้าล้มเหลว** | ข้อความ **ไม่ขึ้นเลย / ค้าง** = การกรอง `session_id` เข้มเกิน (id ไม่ตรงกับของจริง) → ต้องถอย guard ใน `app-store.tsx` (`isCurrentSession`) หรือแก้ให้ตรง id space |

> A1 คือตัวชี้ขาด ถ้าผ่าน แปลว่าการกรองทำงานถูก

### A2. งานเบื้องหลังต้องไม่ปนเข้าแชทที่เปิดอยู่

| | |
| --- | --- |
| **ขั้นตอน** | 1) เปิดแชท A ค้างไว้ (อย่าปิด)<br>2) สั่งให้ agent ทำงานยาว ๆ ในแชท A ค้างไว้ **หรือ** สั่ง cron job ที่มี prompt ให้ agent ตอบ<br>3) ระหว่างนั้นสังเกตแชท A |
| **คาดหวัง** | ข้อความ/tool ของงานเบื้องหลัง **ไม่โผล่ปน** ในแชท A |
| **ก่อนแก้** | ข้อความของเซสชันอื่นจะไหลเข้าแชท A |

### A3. `session.info` ของเซสชันอื่นต้องไม่ทับ model chip

| | |
| --- | --- |
| **ขั้นตอน** | 1) เปิดแชท A ที่ model เป็น X<br>2) ให้ cron/อีกเซสชันที่ model เป็น Y ทำงาน<br>3) ดู model chip ในแชท A |
| **คาดหวัง** | chip ยังเป็น X (ไม่ถูกทับด้วย Y) |

---

## กลุ่ม B — Approval / Clarify (`onAsk`) 🔴

### B1. ask ของแชทปัจจุบันยังเด้งปกติ

| | |
| --- | --- |
| **ขั้นตอน** | ในแชทที่เปิดอยู่ สั่งให้ agent รันคำสั่งที่ต้องขออนุมัติ (เช่นคำสั่งที่ถูก flag ว่าอันตราย) |
| **คาดหวัง** | เด้ง approval sheet ในแชทนั้น + กด Allow/Deny ได้ตามปกติ |

### B2. ask ของเซสชันอื่นต้องไม่ hijack แชทปัจจุบัน แต่ต้องเข้า Inbox

| | |
| --- | --- |
| **ขั้นตอน** | ขณะอยู่แชท A ให้ cron job หรือ background session ที่ต้องขออนุมัติ/ตอบคำถามทำงาน |
| **คาดหวัง** | ไม่เปลี่ยน AskSheet ของแชท A; request ถูกเก็บใน More → Ask Inbox และแจ้งเตือนเมื่อแอปอยู่ background |
| **ตอบจาก notification** | Allow once/Reject ใช้ request ID เดิม; ตอบซ้ำไม่ได้; action ผิด session ไม่ถูกส่ง |
| **หมายเหตุ** | ถ้า profile/stored session ยัง resolve ไม่ได้ ระบบต้อง fail closed และให้เปิด inbox แทนการเดา session |

### B3. Notification action ต้องผูกกับ request เดิม

| | |
| --- | --- |
| **ขั้นตอน** | ให้ background session ขอ approval แล้วกด Allow once หรือ Reject จาก notification |
| **คาดหวัง** | notification action เปิดแอปและขอ local authentication ก่อน; ส่ง JSON-RPC response ด้วย `srq-*` ID เดิม exactly once; inbox เปลี่ยนเป็น sent/answered; event ของ session อื่นไม่ปน |
| **คาดหวังเมื่อ gateway ยังไม่พร้อม** | action ถูกเก็บชั่วคราว แล้วลองใหม่หลัง reconnect โดยไม่ตอบ request ผิด |

### B4. Reconnect ต้องคืน open request

| | |
| --- | --- |
| **ขั้นตอน** | เปิด Ask Inbox ให้มี request, ตัด network/ปิด socket แล้ว reconnect |
| **คาดหวัง** | `open_requests` กลับมาใน inbox โดยไม่สร้างรายการซ้ำและไม่ส่ง notification ซ้ำ; locked clarify answers ถูก restore |

---

## กลุ่ม C — `stop()` ต้องไม่ค้าง 🟡

### C1. กด Stop ระหว่างเทิร์นทำงาน

| | |
| --- | --- |
| **ขั้นตอน** | ระหว่าง agent กำลังตอบ กดปุ่ม Stop (■) |
| **คาดหวัง** | เทิร์นจบ, ปุ่ม Send (↑) กลับมา, แถบ "live — Queue holds…" หายไป, พิมพ์ต่อได้ |

### C2. กด Stop ตอน session หลุด/หมดอายุ (เคสเสี่ยง)

| | |
| --- | --- |
| **ขั้นตอน** | 1) ระหว่างเทิร์นทำงาน ให้ตัดเน็ต หรือทำให้ live session หมดอายุ<br>2) กด Stop |
| **คาดหวัง** | UI **ไม่ค้าง** สถานะ generating — `releaseLocalTurn()` จะปลดล็อกให้ |
| **ก่อนแก้** | จะค้างเป็น generating ตลอดไป ใช้แชทต่อไม่ได้ |

---

## กลุ่ม D — Todo list ต้องอยู่หลังเปิดเซสชัน 🟡

| | |
| --- | --- |
| **ขั้นตอน** | 1) สร้าง/เปิดเซสชันที่มี todo list อยู่แล้ว<br>2) สังเกตแถบ "Tasks" เหนือ composer |
| **คาดหวัง** | checklist แสดงค้างอยู่ (restore จาก `todo_state`) |
| **ก่อนแก้** | แวบขึ้นแล้วหายทันที (`setTodos([])` ทับ) |

---

## กลุ่ม E — Edit ข้ามเซสชัน 🟡

### E1. แบนเนอร์ Editing ต้องไม่ค้างข้ามเซสชัน

| | |
| --- | --- |
| **ขั้นตอน** | 1) กด Edit ที่ข้อความ user ในแชท A<br>2) เปลี่ยนไปแชท B (จาก drawer) หรือกด New chat |
| **คาดหวัง** | แบนเนอร์ "Editing — resend to rewind…" **ไม่ค้าง** ในแชท B |

### E2. ส่งข้อความหลังสลับเซสชัน ต้องไม่ rewind ผิดเซสชัน

| | |
| --- | --- |
| **ขั้นตอน** | หลัง E1 ให้พิมพ์ข้อความใหม่ในแชท B แล้วส่ง |
| **คาดหวัง** | ข้อความถูกส่งเป็นเทิร์นใหม่ปกติ **ไม่** ตัด history ของแชท B ด้วย row id ของแชท A |

---

## กลุ่ม F — Logout ต้องรีเซ็ตสถานะ 🟡

| | |
| --- | --- |
| **ขั้นตอน** | 1) ระหว่าง agent กำลังตอบ ให้ logout<br>2) login ใหม่ |
| **คาดหวัง** | composer อยู่ในสถานะว่างปกติ (ไม่มีปุ่ม Stop ค้าง, ไม่มี queue/todo/ไฟล์แนบ/ask ค้าง) |

---

## กลุ่ม G — ฟีเจอร์อื่นที่แก้ (เช็คเร็ว) ⚪

### G1. Cron run duration
- เปิด Cron Jobs → History ของ job ที่มี run
- คาดหวัง: ระยะเวลา (`⏱ 1m 5s` ฯลฯ) คำนวณถูก แม้ `started_at`/`ended_at` เป็นตัวเลข string

### G2. Files: ไฟล์ binary ต้องไม่ขึ้นเป็นตัวอักษรขยะ
- เปิดไฟล์ non-text (pdf/zip) ใน Files
- คาดหวัง: เห็นข้อความ "Binary or Unsupported File Preview" (ไม่ใช่ mojibake)

### G3. Files: breadcrumb path `~/...`
- นำทางไป path ที่ขึ้นต้นด้วย `~`
- คาดหวัง: breadcrumb กดแล้วไปถูก path (ไม่กลายเป็น `/~/...`)

### G4. Global model บน web
- เปิดเวอร์ชัน web → เลือก "Global" ที่ model
- คาดหวัง: ตั้ง global default สำเร็จ (ก่อนแก้จะเป็น no-op เพราะ `cookie.current` ว่างบน web)

---

## Debug: ดูค่า `session_id` จริง (ถ้า A1/A2 ล้มเหลว)

หัวใจของกลุ่ม A คือ `session_id` ที่ gateway ส่งมา ต้องตรงกับ live session id ที่แอปเก็บ
ถ้าสงสัย ให้เพิ่ม log ชั่วคราวใน `src/lib/gateway-ws.ts` ที่เมธอด `dispatch`:

```ts
private dispatch(type: string, sid: string, body: Record<string, any>) {
  // --- DEBUG (ลบออกหลังทดสอบ) ---
  console.log('[ws-event]', type, 'sid=', JSON.stringify(sid), 'payload_sid=', body?.session_id);
  // ------------------------------
  this.dbg.lastEvent = type;
  // ...ของเดิม
}
```

และใน `src/hooks/app-store.tsx` เพิ่มบรรทัดนี้ใน `isCurrentSession`:

```ts
const isCurrentSession = (sid: string) => {
  // --- DEBUG ---
  console.log('[filter]', 'event_sid=', sid, 'current=', sessionIdRef.current);
  return !sid || !sessionIdRef.current || sid === sessionIdRef.current;
};
```

รัน dev build แล้วเทียบ:
- ถ้า `event_sid` ตรงกับ `current` → ผ่าน (ถ้ายังค้าง ให้ดู A1 อื่น ๆ)
- ถ้าไม่ตรงตลอด → id space ไม่เหมือนกัน ต้องปรับการเทียบ (เช่น เทียบกับ stored id ด้วย)

> ลบ log ทั้งหมดก่อน commit

---

## Checklist สรุป

- [ ] A1 ส่งข้อความ/stream ปกติ
- [ ] A2 งานเบื้องหลังไม่ปนแชท
- [ ] A3 `session.info` ไม่ทับ model chip
- [ ] B1 ask ของแชทปัจจุบันเด้ง
- [ ] B2 ask ของเซสชันอื่นไม่ hijack และเข้า Inbox
- [ ] B3 notification action ผูกกับ request เดิมและตอบครั้งเดียว
- [ ] B4 reconnect คืน open request และ locked clarify answer
- [ ] C1 Stop → Send กลับมา
- [ ] C2 Stop ตอนเน็ตหลุด → ไม่ค้าง
- [ ] D todo restore อยู่
- [ ] E1 Editing ไม่ค้างข้ามเซสชัน
- [ ] E2 ส่งหลังสลับเซสชันไม่ rewind ผิด
- [ ] F logout รีเซ็ตสถานะ
- [ ] G1–G4 ฟีเจอร์ย่อยถูกต้อง

ถ้าข้อไหน fail ให้เก็บ: `BUILD_ID`, ขั้นตอน, ผลที่เห็น, และ log จากส่วน Debug ด้านบน
