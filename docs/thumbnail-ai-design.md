# Thumbnail AI — Design Doc

> เป้าหมาย: สร้าง thumbnail สไตล์ Eazy Cal (กระดานดำ + สมการเรืองแสง + ครู + ตัวอักษรไทยหนามีขอบ)
> ให้ได้ **คุณภาพสูงสุด · cost ต่ำสุด · user ไม่ต้อง edit**
>
> ทีมร่วม: Google (Gemini) + Anthropic (Claude) + OpenAI (gpt-image fallback)
> โมเดลฉากหลักที่เลือก: **Gemini 2.5 Flash Image ("Nano Banana")**

---

## 1. ปัญหาของแนวทางปัจจุบัน

| ส่วน | ของเดิม | ปัญหา |
|---|---|---|
| ข้อความ | Gemini → Claude (mega-call + judge) สร้าง `generated_thumbnail_text` | ดีอยู่แล้ว — เก็บไว้ |
| ภาพ | `next/og` (Satori) เทมเพลตตายตัว: gradient น้ำเงิน + รูปครู + ข้อความขาว | ไม่มีฉาก AI, ตัวอักษรไม่มีขอบ, ไปไม่ถึง reference |

**ทำไม "เจนทั้งใบช็อตเดียว" (gpt-image-1) ไม่ผ่านเป้า "ไม่ต้อง edit":**
image model ทุกตัวยังสะกด/ตัดคำไทยเพี้ยนเป็นบางใบ → พอเพี้ยน user ต้องเข้าไปแก้ = ผิดเป้าทันที

**Insight หลัก:** ตัวอักษรใน reference คือ **graphic layer แบน ๆ มีขอบ (stroke)** ที่แปะทับ ไม่ใช่ภาพที่ AI วาด
→ การแยก layer ตัวอักษรออกมาทำ deterministic **ไม่ได้ทำให้ด้อยกว่า reference** มันคือวิธีที่ reference ทำจริง

---

## 2. สถาปัตยกรรม — "แยกชั้นความเสี่ยง + ลูป QC อัตโนมัติ"

```
transcript
   │
   ▼
① ART DIRECTOR        Gemini 2.5 Flash (text)      ~free
   └─▶ thumbnail_brief: scene / pose / palette / layout / text_layers
   │
   ▼
② SCENE + SUBJECT     Gemini 2.5 Flash Image       ~$0.039/img
   • เจนแค่ "ฉาก + ตัวครู" — สั่งห้ามใส่ตัวอักษร
   • ส่งรูปครู (assets.public_url) เป็น reference → คงหน้าเดิมทุกคลิป
   • เว้นพื้นที่ว่างฝั่งตรงข้ามไว้วางตัวอักษร
   │  (เก็บลง Supabase Storage → videos.generated_thumbnail_scene_url)
   ▼
③ TEXT COMPOSITOR     Satori / next/og             $0
   • วางฉากเป็น backgroundImage
   • วาดตัวอักษรไทยหนา + ขอบ (stacked text-shadow) ตาม text_layers
   • โลโก้ Eazy Cal
   │  → PNG 1280×720
   ▼
④ QC VISION JUDGE     Gemini 2.5 Flash (vision)    ~$0.001   ◀── หัวใจ "ไม่ต้อง edit"
   • อ่าน PNG ที่ composite แล้ว → ตรวจ: legible / face_ok / balanced / not-cut
   • pass → เสร็จ
   • fail → ย้อน ② เจนใหม่ (สูงสุด 2 รอบ) → ยังไม่ผ่าน → fallback gpt-image-1 เฉพาะใบนั้น
   │
   ▼
videos.generated_thumbnail_url  →  preview + อัป YouTube  (user แค่กดดู)
```

### ทำไมโครงนี้ชนะทั้ง 3 เป้า

| เป้า | กลไกที่ทำให้สำเร็จ |
|---|---|
| **ไม่ต้อง edit** | ตัวอักษร deterministic (ถูก 100%) + QC vision คัดใบเสียออกเองก่อนถึง user |
| **cost ต่ำสุด** | สมองใช้ Gemini Flash (เกือบฟรี) · เจนภาพแค่ฉาก 1 ครั้ง · text ฟรี → **~$0.04/ใบ** |
| **คุณภาพสูงสุด** | ฉาก AI จริง (กระดานเรืองแสง/แสงพุ่ง) + หน้าครูคงที่ + ตัวอักษรคมระดับดีไซเนอร์ |

---

## 3. โมเดลที่เลือก + เหตุผล

| Stage | โมเดล | เหตุผล |
|---|---|---|
| ① Art Director | `gemini-2.5-flash` | ถูกสุด, structured output, อยู่บน key เดิม. (เลือก Claude ได้ถ้าต้องการ brief ครีเอทีฟคมขึ้น) |
| ② Scene+Subject | **`gemini-2.5-flash-image`** | คงหน้าครูด้วย reference image แม่น, ถูก (~$0.039), key เดิม |
| ③ Compositor | `next/og` (Satori) | มีในโปรเจกต์แล้ว, ไม่ต้องลง sharp |
| ④ QC Judge | `gemini-2.5-flash` (vision) | reasoning + อ่านภาพได้, ถูก. (Claude เป็นทางเลือกถ้าต้องการความละเอียด) |
| Fallback | `gpt-image-1` | เนียนกว่า/แพงกว่า — ใช้เฉพาะใบที่ QC ตีกลับ 2 รอบ |

---

## 4. การเปลี่ยนแปลงต่อโค้ด (ไม่แตะ logic ข้อความเดิม)

### 4.1 Schema (DB)
เพิ่มคอลัมน์ใน `videos`:
```sql
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS generated_thumbnail_scene_url TEXT,  -- ฉากจาก Gemini (ก่อนใส่ text)
  ADD COLUMN IF NOT EXISTS generated_thumbnail_url TEXT,        -- PNG สุดท้าย (composite แล้ว)
  ADD COLUMN IF NOT EXISTS thumbnail_brief JSONB;               -- brief จาก Art Director
```
สร้าง Supabase Storage bucket `thumbnails` (public read).

### 4.2 Module ใหม่ `src/inngest/thumbnail.ts`
- `buildThumbnailBrief(transcript, analyst, winningText)` → เรียก Gemini Flash, คืน `thumbnail_brief`
- `generateScene(brief, refImageUrl)` → เรียก `gemini-2.5-flash-image` (โหมด edit + reference), คืน buffer
- `compositeText(sceneUrl, textLayers)` → ใช้ผ่าน `/api/og` (ขยายให้รับ sceneUrl)
- `qcThumbnail(pngUrl)` → Gemini vision, คืน `{ pass, legible, face_ok, issues }`
- `produceThumbnail(...)` → orchestrator + ลูป retry ≤2 + fallback

### 4.3 จุดต่อใน `functions.ts`
หลัง `save-results` ([functions.ts:475](../src/inngest/functions.ts)) เพิ่ม step:
```
await step.run("generate-thumbnail", () => produceThumbnail(videoId, ...))
```
ทำหลัง PENDING_APPROVAL ได้ (ภาพมาทีหลังนิดหน่อย, preview poll อยู่แล้ว)

### 4.4 `/api/og/route.tsx`
- รับ `sceneUrl` (หรืออ่าน `generated_thumbnail_scene_url`) → ใช้เป็น `backgroundImage`
- วาด text layers จาก `thumbnail_brief.text_layers` แทน text ขาวเดิม
- ขอบตัวอักษร: ซ้อน `textShadow` หลายทิศ (Satori รองรับ) เลียนแบบ stroke เหลือง/แดง/ดำ
- โหลดฟอนต์ไทยหนา (เช่น Kanit / Anuphan Bold) ผ่าน `fonts` option

### 4.5 `updateYoutube.ts`
[updateYoutube.ts:87](../src/inngest/updateYoutube.ts) — เปลี่ยนจาก fetch `/api/og` สด ๆ
→ ใช้ `videos.generated_thumbnail_url` ที่ QC ผ่านแล้ว (fallback ไป `/api/og` ถ้าว่าง)

### 4.6 `preview/[id]/page.tsx`
- แสดง `generated_thumbnail_url`
- เพิ่มปุ่ม **Regenerate** (กันเหนียว — เคสที่ user อยากได้มุมอื่น)

---

## 5. Prompt / Schema

### ① Art Director — structured output
```ts
const ThumbnailBrief = z.object({
  scene: z.string(),            // EN, ป้อน image model: "dark chalkboard, glowing red calculus equations, dramatic rim light"
  subject_pose: z.string(),     // "arms crossed, confident smile, lit from right"
  layout: z.enum(["subject-left", "subject-right"]),
  color_palette: z.array(z.string()),               // ["#E30613","#FFD400","#0A0A0A"]
  text_layers: z.array(z.object({
    th: z.string(),                                 // ข้อความไทย (จาก generated_thumbnail_text)
    role: z.enum(["headline", "accent", "sub"]),
    fill: z.string(),                               // "#FFD400"
    stroke: z.string(),                             // "#000000"
  })).min(1).max(3),
});
```

### ② Image prompt (เน้น "ห้ามตัวอักษร" + เว้นที่)
```
A 16:9 YouTube thumbnail BACKGROUND with subject. NO text, NO letters, NO numbers as words.
Scene: {scene}.
Subject: the exact person in the reference image (keep identical face), {subject_pose}, cut-out style.
Composition: place the subject on the {layout} side; leave the opposite side clear for graphics.
Lighting: cinematic rim light, high contrast, glowing accents. Colors: {palette}.
Style: bold, dramatic, high-CTR Thai education channel.
Negative: text, words, watermark, logo, blur, low contrast, extra fingers.
```
(ส่ง `assets.public_url` เป็นภาพ reference เข้า request ด้วย)

### ④ QC Judge — structured output
```ts
const QcResult = z.object({
  pass: z.boolean(),
  legible: z.boolean(),       // ตัวอักษรอ่านออก ไม่ทับหน้า
  face_ok: z.boolean(),       // หน้าครูดูปกติ ไม่เพี้ยน
  balanced: z.boolean(),      // องค์ประกอบสมดุล ไม่โดน crop
  issues: z.array(z.string()),// สิ่งที่ต้องแก้ → ป้อนกลับเข้า image prompt รอบถัดไป
});
```
prompt: ส่ง PNG + brief → "ประเมินเหมือน Art Director มืออาชีพ ถ้า fail ให้ระบุ issues ที่ actionable"

---

## 6. ประมาณการ Cost (ต่อ 1 thumbnail)

| รายการ | ราคา |
|---|---|
| ① Art Director (Gemini Flash, ~1k tok) | ~$0.0003 |
| ② Scene (Gemini 2.5 Flash Image) | ~$0.039 |
| ③ Text composite (Satori) | $0 |
| ④ QC vision (Gemini Flash, 1 ภาพ) | ~$0.001 |
| **รวม (เคสผ่านรอบเดียว)** | **~$0.04** |
| เคส retry 1 รอบ | ~$0.08 |
| เคส fallback gpt-image-1 (high) | +$0.17 (เฉพาะใบยาก) |

เทียบ one-shot gpt-image-1 high ทุกใบ = $0.17 + เวลา user แก้คำ → โครงนี้ถูกกว่า ~4 เท่าและ user ไม่ต้องแตะ

---

## 7. แผนลงมือ (phased)

1. **P0 — DB + Storage:** เพิ่มคอลัมน์ + bucket `thumbnails`
2. **P1 — Scene gen:** `thumbnail.ts` (Art Director + Gemini Image) เซฟ scene_url
3. **P2 — Compositor:** ขยาย `/api/og` รับ scene + text layers + ฟอนต์ไทย + ขอบ
4. **P3 — QC loop:** vision judge + retry + fallback
5. **P4 — Wire-up:** ต่อใน `functions.ts`, แก้ `updateYoutube.ts`, ปุ่ม Regenerate ใน preview

แต่ละเฟส deploy ได้อิสระ (P1–P2 เห็นผลภาพก่อน, P3 ค่อยปิดลูปคุณภาพ)

---

## 8. ความเสี่ยง / ข้อควรระวัง

- **ฟอนต์ไทยใน Satori (edge runtime):** ต้องโหลด .ttf เอง (Kanit/Anuphan Bold). ตรวจให้ครอบคลุม glyph ไทย
- **Gemini Image latency:** ~5–15s/ภาพ → ทำใน Inngest step (async) ไม่บล็อก UI; preview poll รับได้
- **Storage:** ตั้ง public-read + cache; ลบ scene ชั่วคราวได้ถ้าต้องการประหยัด
- **ลูป QC ไม่จบ:** hard cap 2 รอบ → fallback → ถ้ายัง ใช้ Satori-only template เดิมเป็น safety net (ไม่มีทาง fail ถึงมือ user แบบไม่มีรูป)

---

## 9. Best Practice ล่าสุด (สรุปร่วม Google + Anthropic + OpenAI)

1. **Thumbnail = ปัญหา "ระบบดีไซน์" ไม่ใช่ "เจนรูป"** — ออกแบบเป็น template/slot ที่ AI เติม → on-brand + zero-edit ได้จริง
2. **อย่าให้ image model วาดตัวอักษร (โดยเฉพาะไทย)** — overlay deterministic เสมอ
3. **คงตัวละครด้วย reference image** ไม่ใช่บรรยายหน้าเป็นคำ
4. **Structured prompt + negative prompt + composition hint** ("เว้นที่ฝั่ง X")
5. **ปิดลูปด้วย vision-as-judge** → การันตี zero-edit เชิงระบบ ไม่ใช่ลุ้น
6. **Dynamic content บน static brand frame** (ไม่ static ล้วน/ไม่ dynamic ล้วน)
7. **Progressive disclosure** — default ทำงานโดยไม่ต้องกรอก, power user ค่อย override
8. **Observability** — log QC score + first-pass rate + (ภายหลัง) CTR เพื่อปรับ prompt

---

## 10. แนวที่ดีกว่าเดิม — "Background Library + content-aware reuse" ⭐

**ปัญหาของ §2:** เจนฉาก AI ใหม่ "ทุกใบ" = จ่าย ~$0.039 ทุกครั้ง ทั้งที่ช่องติว
ส่วนใหญ่ใช้ฉาก "กระดานดำ" คล้าย ๆ กัน → จ่ายซ้ำของที่เหมือนเดิม

**วิธีที่ดีกว่า:** ให้ Art Director ตัดสินใจ **reuse vs generate-fresh**

```
Art Director เพิ่ม field:  needs_custom_scene: boolean + scene_tag: string
        │
        ├── needs_custom_scene = false  (เคสส่วนใหญ่)
        │     └─▶ ดึงฉากจาก Background Library (เจนไว้ครั้งเดียว/แบรนด์)
        │         + recolor ตาม palette → composite → cost ภาพ ≈ $0
        │
        └── needs_custom_scene = true   (คลิป hero / เนื้อหาเฉพาะ)
              └─▶ เจน Gemini Image สด + เก็บกลับเข้า Library (โตขึ้นเอง)
```

**ผลลัพธ์ cost เฉลี่ย:**

| โหมด | cost/ใบ |
|---|---|
| เคส reuse (ส่วนใหญ่) | **~$0.001** (แค่ brain + QC, ภาพ $0) |
| เคส custom scene | ~$0.04 |
| **เฉลี่ยจริง (สมมติ reuse 80%)** | **~$0.009/ใบ** |

→ ถูกกว่า §2 (~$0.04) อีก ~4 เท่า **และ** brand consistency สูงขึ้น (ใช้ฉากชุดเดียวกัน) Library ยังโตเองเมื่อมีฉากใหม่

**ผูกกับ `qualityMode` ที่มีอยู่แล้ว:**
- `qualityMode = fast/normal` → reuse-first, QC 1 รอบ
- `qualityMode = high` → บังคับ custom scene + **Best-of-2** (เจน 2 ใบ ให้ vision judge เลือก) สำหรับคลิปสำคัญ

---

## 11. สิ่งที่ต้อง implement (final checklist)

**P0 — Foundation**
- [ ] DB: `videos` + `generated_thumbnail_url`, `generated_thumbnail_scene_url`, `thumbnail_brief`(jsonb), `thumbnail_qc`(jsonb)
- [ ] DB: ตาราง `brand_kits` (static frame: palette, font, logo, layout grammar) — seed 1 default ของ Eazy Cal
- [ ] DB: ตาราง `thumbnail_backgrounds` (Library: scene_tag, url, palette)
- [ ] Supabase Storage bucket `thumbnails` (public read) + ฟอนต์ไทยหนา (Kanit/Anuphan Bold .ttf)

**P1 — Brain + Scene**
- [ ] `src/inngest/thumbnail.ts`: `buildBrief()` (Gemini Flash, รับ Brand Kit + transcript + `directorsNote` + ref ถ้ามี → `thumbnail_brief` พร้อม `needs_custom_scene`)
- [ ] `resolveScene()`: reuse จาก Library หรือเจน Gemini 2.5 Flash Image (+reference รูปครู)

**P2 — Compositor**
- [ ] ขยาย `/api/og/route.tsx`: รับ sceneUrl + วาด text layers ไทยหนามีขอบ (stacked text-shadow) + โลโก้ + ฟอนต์ไทย

**P3 — QC loop**
- [ ] `qcThumbnail()` (Gemini vision) + retry ≤2 + fallback gpt-image-1 + safety-net template เดิม

**P4 — Wire-up + Override UI**
- [ ] ต่อ step ใน `functions.ts` หลัง save-results
- [ ] `updateYoutube.ts`: ใช้ `generated_thumbnail_url` (fallback `/api/og`)
- [ ] `preview/[id]`: แสดงรูป + ปุ่ม Regenerate
- [ ] Dashboard: ใต้ "Advanced" เพิ่มอัป **reference image** (style/subject) — optional

---

## 12. Implementation status (as-built)

ทั้ง 5 เฟส implement แล้ว (typecheck ผ่าน). จุดที่ตัดสินใจให้ lean/safe ต่างจากแผนเดิม:

- **Storage:** ใช้ bucket `assets` เดิม + prefix `thumbnails/` (ไม่สร้าง bucket ใหม่)
- **Brand Kit:** เป็น constant ใน [src/lib/thumbnail/brand.ts](../src/lib/thumbnail/brand.ts) + รวม Brand DNA เดิม (assets/settings/brand_dna.json) — ไม่ทำตาราง `brand_kits` ใหม่
- **Composite = `/api/og` อย่างเดียว** (dynamic). ไม่อัปโหลด PNG ซ้ำ → `updateYoutube.ts` **ไม่ต้องแก้** (มันดึง og อยู่แล้ว ได้รูปใหม่อัตโนมัติ)
- **Image gen (dual-provider):** `THUMBNAIL_IMAGE_PROVIDER=auto` → ลอง **Gemini REST** (`gemini-2.5-flash-image`, ถูกสุด) ก่อน, ล้ม → fallback **gpt-image-1** อัตโนมัติ (โหมด edit + reference รูปครู คงหน้าเดิม).
  - ⚠️ **Gemini image model ไม่อยู่บน free tier** (429, limit 0) — ต้องเปิด billing; ระหว่างนี้ตั้ง `THUMBNAIL_IMAGE_PROVIDER=openai` ใช้ gpt-image-1 ได้เลย
- **Font fix:** URL jsdelivr ต้องมี `@main` (`.../gh/google/fonts@main/...`) ไม่งั้น 404 → Satori 500 (ทำให้แม้แต่เทมเพลต fallback ก็ไม่ขึ้น)
- **Degrade-gracefully ทุกชั้น:** ไม่มี GEMINI key / gen ล้ม / QC ล้ม → ตกไปเทมเพลต Satori เดิม, pipeline ไม่มีทางพังเพราะ thumbnail
- **State ใหม่:** `GENERATING_THUMBNAIL` (preview poll ต่อจนเสร็จ)
- **Best-of-N:** ยังไม่ทำ (ใช้ retry-on-QC-fail แทน — Maximize = สูงสุด 3 รอบ) — เป็น future enhancement

ไฟล์ที่เพิ่ม: `src/lib/thumbnail/{brand,brief,scene,qc,index}.ts`, `src/inngest/regenerateThumbnail.ts`, `src/app/api/videos/[id]/regenerate-thumbnail/route.ts`, `database_migration_thumbnail.sql`
ไฟล์ที่แก้: `og/route.tsx`, `functions.ts`, `process-video/route.ts`, `inngest/route.ts`, `preview/[id]/page.tsx`, `dashboard/page.tsx`, `settings/actions.ts`, `.env.example`

**ขั้นตอนเปิดใช้:** รัน `database_migration_thumbnail.sql` ใน Supabase + ตั้ง `GEMINI_API_KEY` (มีอยู่แล้ว). bucket `assets` ต้อง public (เป็นอยู่แล้ว).

