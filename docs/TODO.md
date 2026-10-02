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

## 2. อื่นๆ ที่เจอแล้วยังไม่ได้แก้

- **PA Signal หลุดออฟไลน์เป็นระยะ** — ยังไม่เคยไล่หาสาเหตุ
- **backup retention ปนกัน** — ชุดรายวันกับชุดที่สร้างตอน deploy นับรวมกันเป็น 14
  ชุด ทำให้วันที่ deploy หลายรอบ ชุดรายวันเก่าถูกดันหายเร็วกว่าที่ตั้งใจ
- **error 413 (ไฟล์ใหญ่เกิน) ไม่ถูกบันทึก** — ผู้ใช้เจออัปโหลดไม่ผ่านแต่ log เงียบ
- **lint error เก่าใน `BotTable.tsx` และ `OrderDraft.tsx`** — มีมาก่อน ตั้งใจไม่แตะ
