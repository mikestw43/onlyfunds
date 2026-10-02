# งานค้าง — OnlyFunds

## 1. เปลี่ยน repo เป็น private  ⚠️ ทำผิดลำดับแล้ว deploy พัง

`github.com/mikestw43/onlyfunds` ตอนนี้เป็น **public**

**ตรวจแล้วว่าไม่มีอะไรหลุด** (สแกนทั้ง 277 commit เมื่อ 2026-10-02):
ไม่มี API key, ไม่มีรหัสผ่าน, ไม่มีไฟล์ฐานข้อมูล, ไม่มี .env ตัวจริง, ไม่มี backup
— `deploy/.env.production` ที่อยู่ใน repo เป็นแค่เทมเพลตค่า `CHANGE_ME`

**ที่เปิดอยู่จริงๆ มี 2 อย่าง**
- IP เซิร์ฟเวอร์ `168.144.251.72` อยู่ใน `deploy/README.md`
- โค้ดทั้งหมดอ่านได้ → ใครก็นั่งหาช่องโหว่ได้ (แบบ IDOR ที่แก้ไปแล้ว)

ไม่ใช่เรื่องฉุกเฉิน แต่เป็นแดชบอร์ดที่ผูกกับเงินจริง ไม่มีเหตุผลที่ต้องเปิด

### กับดัก
droplet ดึงโค้ดด้วย `git clone https://github.com/mikestw43/onlyfunds.git`
**แบบไม่มี credential** — มันทำงานได้เพราะ repo เป็น public

กดเป็น private ก่อนทำอย่างอื่น → `git pull` ล้มเหลว → `update.sh` มี `set -e`
→ **auto-deploy หยุดเงียบๆ** เว็บยังเปิดได้ แต่ไม่อัปเดตอีกเลย กว่าจะรู้ตัวคือ
ตอนสงสัยว่าทำไม push แล้วไม่ขึ้น

### ลำดับที่ถูก
1. ที่ droplet: สร้าง SSH key
   ```
   ssh-keygen -t ed25519 -C "onlyfunds-droplet" -f /root/.ssh/github_deploy -N ""
   cat /root/.ssh/github_deploy.pub
   ```
2. GitHub → repo onlyfunds → Settings → **Deploy keys** → Add deploy key
   → แปะบรรทัดที่ได้ → **ไม่ต้องติ๊ก** "Allow write access" (อ่านอย่างเดียวพอ)
3. ที่ droplet: ให้ git ใช้กุญแจนี้ แล้วเปลี่ยน remote เป็น SSH
   ```
   printf 'Host github.com\n  IdentityFile /root/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> /root/.ssh/config
   cd /opt/onlyfunds && git remote set-url origin git@github.com:mikestw43/onlyfunds.git
   ssh -T git@github.com    # ต้องตอบว่า successfully authenticated
   git pull                 # ต้องดึงได้
   ```
4. **ค่อย** GitHub → Settings → Danger Zone → Change visibility → **Private**
5. รอ deploy รอบถัดไป (ไม่เกิน 5 นาที) แล้วเช็กว่ายังอัปเดตปกติ

กุญแจส่วนตัวอยู่บน droplet เท่านั้น ไม่ต้องส่งให้ใคร
Vercel ที่ผูกกับ repo นี้ ใช้ GitHub App อยู่แล้ว เป็น private ก็ดึงได้ปกติ

---

## 2. EA ส่งข้อความออกมาเป็น encoding ผิด — ตัวอักษรเพี้ยนเป็น `�`

**รอรวมกับการแก้ EA ครั้งหน้า จะได้คอมไพล์ทีเดียว** (เจอ 2026-10-02 ตอนเทส v1.6)

เห็นในการ์ดสั่งออเดอร์:
```
...is too close to the market on XAUUSD � the spread is 32 points...   ← ควรเป็น —
✓ opened at 4188.33, SL 4186.33 TP �                                   ← ควรเป็น —
```

ตัวเลขและการเทรดถูกหมด เป็นเรื่องความสวยงามล้วนๆ

### สาเหตุ
`ea/OnlyFunds_Reporter_v1.6.mq5` ส่ง JSON ออกไปโดยไม่ได้บอก codepage
`StringToCharArray` จึงใช้ค่าเริ่มต้น CP_ACP (ANSI ของ Windows) — em dash `—`
กลายเป็นไบต์เดียว 0x97 ซึ่งไม่ใช่ UTF-8 ที่ถูกต้อง เซิร์ฟเวอร์เลยอ่านเป็น `�`
แก้ฝั่งเซิร์ฟเวอร์ไม่ได้ เพราะไบต์เดิมเสียไปตั้งแต่ก่อนถึงมือเราแล้ว

### ที่ต้องแก้ (3 บรรทัด)
```cpp
// บรรทัด 1392 และ 1547 — ขาเข้ารหัสตอนส่งออก
StringToCharArray(json, post, 0, StringLen(json), CP_UTF8);

// บรรทัด 1570 — ขาถอดรหัสตอนรับคำสั่งกลับมา (ไม่งั้นข้อความไทยจาก
// เซิร์ฟเวอร์ เช่น comment ของออเดอร์ จะเพี้ยนในทางกลับกัน)
HandleCommands(CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
```
แล้วรัน `python3 scripts/build-ea-variants.py` เพื่อสร้างไฟล์ทั้งสองตัวใหม่

**ต้องคอมไพล์ใหม่ที่ MetaEditor** (เครื่องนี้คอมไพล์ MQL5 ไม่ได้) → ขึ้นเป็น v1.7

---

## 3. ล็อกอินด้วย Face ID / ลายนิ้วมือ (WebAuthn / Passkey) — ยังไม่ได้ทำ

อยากได้ ยังไม่ตัดสินใจว่าจะทำที่เว็บไหนก่อน (คุยไว้ 2026-10-02)

**ทำได้แน่นอน** ของที่ต้องมีเรามีครบแล้ว: HTTPS + โดเมนจริง + ลง Home Screen
เป็น PWA — เว็บเรียก Face ID ได้โดยไม่ต้องทำแอป iOS

เว็บไม่เคยเห็นหน้าใคร Face ID ปลดกุญแจที่อยู่ใน Secure Enclave ของเครื่อง
แล้วเอามาเซ็น challenge ฝั่งเราเก็บแค่ public key ซึ่งหลุดไปก็ใช้ทำอะไรไม่ได้
กันฟิชชิ่งได้ด้วยเพราะกุญแจผูกกับโดเมน

### สองแบบ
- **A. ล็อกอินด้วย Face ID เลย** (passkey) — ไม่ต้องพิมพ์รหัสผ่านอีก เก็บรหัสผ่าน
  ไว้เป็นทางสำรองตอนเครื่องใหม่
- **B. ล็อกหน้าแอป** — ล็อกอินปกติ แต่เปิดแอปทีไรต้องสแกนก่อนเห็นตัวเลข
  (แบบแอปธนาคาร)

ทำ A ก่อนแล้วเติม B ทีหลังได้ ใช้กุญแจตัวเดียวกัน

### ของที่ต้องเขียน (ประมาณครึ่งวัน)
- `@simplewebauthn/server` ฝั่ง backend, `@simplewebauthn/browser` ฝั่งหน้าเว็บ
- ตารางใหม่ 1 ตาราง หน้าตาคล้าย `PushDevice`:
  credentialId (unique), publicKey, counter, label, userId, createdAt, lastUsedAt
- API 4 เส้น: เริ่มลงทะเบียน / ยืนยันลงทะเบียน / เริ่มล็อกอิน / ยืนยันล็อกอิน
- ปุ่มในหน้า Settings + รายการอุปกรณ์ที่ลงทะเบียนไว้ (ถอดออกได้)

### ข้อควรระวัง
- **กุญแจผูกกับชื่อโดเมน (RP ID)** — ย้ายจาก `onlyfunds.duckdns.org` ไปโดเมนอื่น
  เมื่อไหร่ ทุกคนต้องลงทะเบียนใหม่หมด ถ้าคิดจะย้ายโดเมน ย้ายให้เสร็จก่อนค่อยทำ
- ต้องเหลือทางเข้าสำรอง (รหัสผ่าน) เสมอ เผื่อทำมือถือหาย
- ลงทะเบียนทีละเครื่อง แต่ iPhone/iPad/Mac ที่ใช้ iCloud เดียวกัน sync ให้เอง
- Android ใช้ลายนิ้วมือ, Windows ใช้ Windows Hello — API ตัวเดียวกันหมด

**เว็บบัญชี/เงินเดือนตัวใหม่ยิ่งควรมี** เพราะเก็บเงินเดือนและเลขบัตรประชาชน
ถ้าจะทำที่นั่น บอกแชทนั้นว่า "อยากได้ล็อกอินด้วย Face ID ใช้ WebAuthn/passkey
วางโครงเผื่อไว้ตั้งแต่ตอนออกแบบ auth เลย"

---

## 4. อื่นๆ ที่เจอแล้วยังไม่ได้แก้

- **PA Signal หลุดออฟไลน์เป็นระยะ** — ยังไม่เคยไล่หาสาเหตุ
- **backup retention ปนกัน** — ชุดรายวันกับชุดที่สร้างตอน deploy นับรวมกันเป็น 14
  ชุด ทำให้วันที่ deploy หลายรอบ ชุดรายวันเก่าถูกดันหายเร็วกว่าที่ตั้งใจ
- **error 413 (ไฟล์ใหญ่เกิน) ไม่ถูกบันทึก** — ผู้ใช้เจออัปโหลดไม่ผ่านแต่ log เงียบ
- **lint error เก่าใน `BotTable.tsx` และ `OrderDraft.tsx`** — มีมาก่อน ตั้งใจไม่แตะ
