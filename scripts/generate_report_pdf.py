#!/usr/bin/env python3
"""Villa Access Control — професионален PDF отчет (BG)."""
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    PageBreak, Table, TableStyle, KeepTogether, FrameBreak, NextPageTemplate,
)
from reportlab.platypus.flowables import HRFlowable

# ─── Fonts (Cyrillic) ────────────────────────────────────────────────────────
pdfmetrics.registerFont(TTFont("DejaVu",      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))

# ─── Palette — modern dark teal + accent gold ────────────────────────────────
NAVY    = HexColor("#0F1F3D")   # cover bg
TEAL    = HexColor("#14B8A6")   # accent
TEAL_D  = HexColor("#0D9488")
GOLD    = HexColor("#F5C758")
INK     = HexColor("#0F172A")   # body text
MUTED   = HexColor("#64748B")
LIGHT   = HexColor("#F8FAFC")
CARD    = HexColor("#F1F5F9")
LINE    = HexColor("#E2E8F0")
GREEN   = HexColor("#16A34A")
RED     = HexColor("#DC2626")
AMBER   = HexColor("#D97706")

# ─── Styles ──────────────────────────────────────────────────────────────────
H1 = ParagraphStyle("H1", fontName="DejaVu-Bold", fontSize=26, leading=32,
                     textColor=NAVY, spaceAfter=4*mm, spaceBefore=2*mm)
H2 = ParagraphStyle("H2", fontName="DejaVu-Bold", fontSize=16, leading=22,
                     textColor=TEAL_D, spaceAfter=3*mm, spaceBefore=6*mm)
H3 = ParagraphStyle("H3", fontName="DejaVu-Bold", fontSize=12, leading=16,
                     textColor=NAVY, spaceAfter=2*mm, spaceBefore=3*mm)
BODY = ParagraphStyle("Body", fontName="DejaVu", fontSize=10.5, leading=15,
                      textColor=INK, spaceAfter=2*mm, alignment=TA_LEFT)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=12, bulletIndent=2,
                        bulletFontName="DejaVu-Bold", bulletFontSize=10.5)
MUTED_S = ParagraphStyle("Muted", fontName="DejaVu", fontSize=9, leading=12,
                          textColor=MUTED)
COVER_TITLE = ParagraphStyle("CoverT", fontName="DejaVu-Bold", fontSize=44,
                              leading=52, textColor=white, alignment=TA_LEFT)
COVER_SUB   = ParagraphStyle("CoverS", fontName="DejaVu", fontSize=18, leading=24,
                              textColor=HexColor("#A5F3FC"), alignment=TA_LEFT)
COVER_META  = ParagraphStyle("CoverM", fontName="DejaVu", fontSize=11, leading=15,
                              textColor=HexColor("#CBD5E1"), alignment=TA_LEFT)
CHIP        = ParagraphStyle("Chip", fontName="DejaVu-Bold", fontSize=8.5,
                              leading=11, textColor=white, alignment=TA_CENTER)

OUT_PATH = "exports/VillaAccess_Report_BG.pdf"

# ─── Page decorations ────────────────────────────────────────────────────────
def cover_bg(canvas, doc):
    w, h = A4
    canvas.saveState()
    # Navy background
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    # Teal diagonal band
    canvas.setFillColor(TEAL)
    p = canvas.beginPath()
    p.moveTo(0, h*0.55); p.lineTo(w, h*0.40); p.lineTo(w, h*0.45); p.lineTo(0, h*0.60); p.close()
    canvas.drawPath(p, fill=1, stroke=0)
    # Gold accent dots
    canvas.setFillColor(GOLD)
    for x, y, r in [(w-40*mm, h-30*mm, 3.5*mm), (w-25*mm, h-42*mm, 2*mm),
                    (30*mm, 25*mm, 2.5*mm), (45*mm, 18*mm, 1.5*mm)]:
        canvas.circle(x, y, r, fill=1, stroke=0)
    canvas.restoreState()

def content_bg(canvas, doc):
    w, h = A4
    canvas.saveState()
    # Top accent strip
    canvas.setFillColor(NAVY)
    canvas.rect(0, h-12*mm, w, 12*mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, h-12*mm, w*0.30, 2*mm, fill=1, stroke=0)
    # Header text
    canvas.setFont("DejaVu-Bold", 9); canvas.setFillColor(white)
    canvas.drawString(18*mm, h-8*mm, "VILLA ACCESS CONTROL")
    canvas.setFont("DejaVu", 8); canvas.setFillColor(HexColor("#94A3B8"))
    canvas.drawRightString(w-18*mm, h-8*mm, "Отчет за състоянието на проекта")
    # Footer
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(18*mm, 14*mm, w-18*mm, 14*mm)
    canvas.setFont("DejaVu", 8); canvas.setFillColor(MUTED)
    canvas.drawString(18*mm, 9*mm, f"Генерирано: {datetime.now().strftime('%d.%m.%Y')}")
    canvas.drawRightString(w-18*mm, 9*mm, f"стр. {doc.page-1}")
    canvas.restoreState()

# ─── Document setup ──────────────────────────────────────────────────────────
doc = BaseDocTemplate(OUT_PATH, pagesize=A4,
                      leftMargin=18*mm, rightMargin=18*mm,
                      topMargin=18*mm, bottomMargin=18*mm,
                      title="Villa Access Control — Отчет",
                      author="Villa Access Control")

cover_frame   = Frame(18*mm, 18*mm, A4[0]-36*mm, A4[1]-36*mm, id="cover", showBoundary=0,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
content_frame = Frame(18*mm, 20*mm, A4[0]-36*mm, A4[1]-38*mm, id="content", showBoundary=0,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

doc.addPageTemplates([
    PageTemplate(id="Cover",   frames=[cover_frame],   onPage=cover_bg),
    PageTemplate(id="Content", frames=[content_frame], onPage=content_bg),
])

# ─── Reusable builders ───────────────────────────────────────────────────────
def chip(text, color):
    """Coloured pill."""
    t = Table([[Paragraph(text, CHIP)]], colWidths=[None], rowHeights=[7*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), color),
        ("BOX",        (0,0), (-1,-1), 0, color),
        ("ALIGN",      (0,0), (-1,-1), "CENTER"),
        ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",(0,0), (-1,-1), 6),
        ("RIGHTPADDING",(0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 1),
        ("BOTTOMPADDING",(0,0),(-1,-1), 1),
    ]))
    return t

def card(title, body_paragraphs, accent=TEAL):
    """Card with coloured left border."""
    inner = [Paragraph(f"<b>{title}</b>", H3)] + body_paragraphs
    tbl = Table([[inner]], colWidths=[A4[0]-36*mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), CARD),
        ("LINEBEFORE",  (0,0), (-1,-1), 3, accent),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING",(0,0), (-1,-1), 10),
        ("TOPPADDING",  (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0),(-1,-1), 8),
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
    ]))
    return tbl

def stat_row(items):
    """Row of big-number stat boxes. items=[(big, label), ...]"""
    cells = []
    for big, label in items:
        cell = [
            Paragraph(f'<font name="DejaVu-Bold" size="22" color="#14B8A6">{big}</font>', BODY),
            Paragraph(f'<font color="#64748B" size="9">{label}</font>', BODY),
        ]
        cells.append(cell)
    tbl = Table([cells], colWidths=[(A4[0]-36*mm)/len(items)]*len(items))
    tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), white),
        ("BOX",         (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID",   (0,0), (-1,-1), 0.5, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0), (-1,-1), 12),
        ("TOPPADDING",  (0,0), (-1,-1), 10),
        ("BOTTOMPADDING",(0,0),(-1,-1), 10),
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
    ]))
    return tbl

def bullets(items):
    """Bulleted paragraph list."""
    out = []
    for it in items:
        out.append(Paragraph(
            f'<font color="#14B8A6"><b>▸</b></font>&nbsp;&nbsp;{it}', BULLET
        ))
    return out

def feature_table(rows):
    """3-column features table: [icon, title+desc]."""
    data = []
    for icon, title, desc in rows:
        data.append([
            Paragraph(f'<font name="DejaVu-Bold" color="#14B8A6" size="16">{icon}</font>', BODY),
            [Paragraph(f"<b>{title}</b>", H3),
             Paragraph(f'<font color="#475569">{desc}</font>', BODY)],
        ])
    tbl = Table(data, colWidths=[14*mm, A4[0]-36*mm-14*mm])
    tbl.setStyle(TableStyle([
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
        ("LINEBELOW",   (0,0), (-1,-2), 0.4, LINE),
        ("TOPPADDING",  (0,0), (-1,-1), 6),
        ("BOTTOMPADDING",(0,0),(-1,-1), 6),
        ("LEFTPADDING", (0,0), (-1,-1), 2),
    ]))
    return tbl

# ─── Content ─────────────────────────────────────────────────────────────────
story = []

# ===== COVER =====
story.append(Spacer(1, 40*mm))
story.append(Paragraph("VILLA ACCESS<br/>CONTROL", COVER_TITLE))
story.append(Spacer(1, 6*mm))
story.append(Paragraph("AI система за управление на достъп до вили", COVER_SUB))
story.append(Spacer(1, 80*mm))
story.append(Paragraph("Отчет за състоянието на проекта", COVER_META))
story.append(Paragraph(f"Версия от {datetime.now().strftime('%d %B %Y')}", COVER_META))
story.append(Spacer(1, 4*mm))
story.append(Paragraph(
    '<font color="#F5C758"><b>Production deployment:</b></font>  6.5.4.254  •  '
    '<font color="#F5C758"><b>Repo:</b></font>  github.com/mladenovpeter-maker/VillaAccess',
    COVER_META))

# ===== PAGE 2: КАКВО Е ТОВА =====
story.append(NextPageTemplate("Content"))
story.append(PageBreak())

story.append(Paragraph("Какво представлява системата", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "<b>Villa Access Control</b> е AI-базирана платформа за автоматичен и контролиран "
    "достъп до вили, апартаменти и затворени комплекси. Системата обединява разпознаване "
    "на регистрационни номера (ANPR), smart ключалки, домофони, камери и резервационна "
    "система в едно работно място — без оператор на портала.", BODY))
story.append(Spacer(1, 4*mm))

story.append(stat_row([
    ("4", "канала за достъп"),
    ("24/7", "автоматичен режим"),
    ("3", "роли (admin / operator / viewer)"),
    ("BG", "локализиран UI"),
]))
story.append(Spacer(1, 6*mm))

story.append(Paragraph("Кой ползва системата", H2))
story.append(feature_table([
    ("👤", "Администратор",
     "Управлява вили, устройства, потребители, резервации; вижда всичко, "
     "включително диагностика и event логове."),
    ("⚙", "Оператор",
     "Издава временни PIN кодове за гости, отваря врати ръчно при нужда, "
     "одобрява/отхвърля заявки за достъп от ANPR."),
    ("👁", "Наблюдател",
     "Само за четене — събития, статус, история. Полезно за нощни смени, "
     "охрана, мениджъри."),
]))

# ===== PAGE 3: ВЪЗМОЖНОСТИ =====
story.append(PageBreak())
story.append(Paragraph("Какво може системата", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))

story.append(Paragraph("Основни модули", H2))

story.append(card("🚗 ANPR — разпознаване на регистрационни номера", [
    Paragraph(
        "Камери на портала автоматично четат номера на пристигащи коли. Системата ги "
        "сравнява с активни резервации и одобрени превозни средства, и автоматично "
        "отваря бариерата или вратата чрез релейна команда към интеркома.", BODY),
    Paragraph(
        '<font color="#64748B" size="9">Стек: YOLO + EasyOCR worker, fuzzy matching '
        'на номера, snapshot история на всяко четене.</font>', BODY),
]))
story.append(Spacer(1, 3*mm))

story.append(card("🔐 Smart Locks (Tuya)", [
    Paragraph(
        "Управление на интелигентни ключалки през Tuya Cloud API. Издаване на временни "
        "PIN кодове за гости, които автоматично се синхронизират към ключалките за "
        "периода на резервацията и се изтриват след нея.", BODY),
]))
story.append(Spacer(1, 3*mm))

story.append(card("📞 Домофони и Hikvision камери", [
    Paragraph(
        "Live статус, ISAPI диагностика, видео snapshots при event-и. Интегрирани "
        "Hikvision IP камери с пълна network диагностика (DNS, port, auth, device info).", BODY),
]))
story.append(Spacer(1, 3*mm))

story.append(card("📅 Резервационна система", [
    Paragraph(
        "Управление на резервации с автоматично генериране на PIN кодове за периода "
        "на престоя, авто-изтичане, история и одит. Свързано с превозните средства "
        "на госта за автоматично ANPR одобрение.", BODY),
]))
story.append(Spacer(1, 3*mm))

story.append(card("⏱ Временни credentials", [
    Paragraph(
        "Бързо издаване на еднократен/ограничен във времето достъп — за куриери, "
        "техници, чистачи. Достъпно и от operator роля (без admin намеса).", BODY),
]))
story.append(Spacer(1, 3*mm))

story.append(card("📊 Event timeline и одит", [
    Paragraph(
        "Всяко отваряне, всяко четене на номер, всяка ANPR грешка, всеки нов PIN — "
        "записано с timestamp и потребител. SSE live stream + REST история + статистика "
        "за последните 24 часа.", BODY),
]))

# ===== PAGE 4: АРХИТЕКТУРА =====
story.append(PageBreak())
story.append(Paragraph("Архитектура и комуникация", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))

story.append(Paragraph(
    "Цялата комуникация с устройствата е <b>изходяща (outbound)</b> от backend-а. "
    "Камерите, домофоните и ключалките <b>никога не звънят</b> на сървъра — той ги "
    "пита периодично. Това позволява максимално затваряне на портове без да се "
    "наруши работата.", BODY))
story.append(Spacer(1, 4*mm))

flow = Table([
    [Paragraph('<b>Backend</b><br/><font size="8" color="#64748B">Node.js + Express</font>', BODY),
     Paragraph('<font color="#14B8A6" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Hikvision камери</b><br/><font size="8" color="#64748B">ISAPI / HTTP</font>', BODY)],
    [Paragraph('<b>Backend</b>', BODY),
     Paragraph('<font color="#14B8A6" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Tuya Cloud</b><br/><font size="8" color="#64748B">openapi.tuyaeu.com</font>', BODY)],
    [Paragraph('<b>Backend</b>', BODY),
     Paragraph('<font color="#14B8A6" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Домофони</b><br/><font size="8" color="#64748B">HTTP relay команди</font>', BODY)],
    [Paragraph('<b>ANPR Worker</b><br/><font size="8" color="#64748B">YOLO + EasyOCR</font>', BODY),
     Paragraph('<font color="#14B8A6" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Backend</b><br/><font size="8" color="#64748B">Docker internal net</font>', BODY)],
    [Paragraph('<b>Frontend (nginx)</b><br/><font size="8" color="#64748B">SPA + /api proxy</font>', BODY),
     Paragraph('<font color="#14B8A6" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Backend</b><br/><font size="8" color="#64748B">Docker internal net</font>', BODY)],
    [Paragraph('<b>Потребител (браузър)</b>', BODY),
     Paragraph('<font color="#F5C758" size="14"><b>→</b></font>', BODY),
     Paragraph('<b>Frontend (порт 3000)</b><br/><font size="8" color="#64748B">единствена публична точка</font>', BODY)],
], colWidths=[(A4[0]-36*mm)*0.40, (A4[0]-36*mm)*0.10, (A4[0]-36*mm)*0.50])
flow.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (-1,-1), CARD),
    ("LINEBELOW",   (0,0), (-1,-2), 0.4, LINE),
    ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 10),
    ("RIGHTPADDING",(0,0), (-1,-1), 10),
    ("TOPPADDING",  (0,0), (-1,-1), 8),
    ("BOTTOMPADDING",(0,0),(-1,-1), 8),
    ("ALIGN",       (1,0), (1,-1), "CENTER"),
]))
story.append(flow)
story.append(Spacer(1, 6*mm))

story.append(Paragraph("Технологичен стек", H2))
tech = Table([
    [Paragraph('<b>Frontend</b>', BODY),
     Paragraph("React 18 + Vite + TypeScript + TailwindCSS + Radix UI", BODY)],
    [Paragraph('<b>Backend</b>', BODY),
     Paragraph("Node.js + Express 5 + TypeScript + Drizzle ORM", BODY)],
    [Paragraph('<b>База данни</b>', BODY),
     Paragraph("PostgreSQL 16", BODY)],
    [Paragraph('<b>AI / ANPR</b>', BODY),
     Paragraph("Python worker — YOLO детекция + EasyOCR четене", BODY)],
    [Paragraph('<b>Deployment</b>', BODY),
     Paragraph("Docker Compose, self-hosted на 6.5.4.254", BODY)],
    [Paragraph('<b>Monorepo</b>', BODY),
     Paragraph("pnpm workspaces — dashboard / api-server / db / api-zod", BODY)],
], colWidths=[35*mm, A4[0]-36*mm-35*mm])
tech.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (0,-1), NAVY),
    ("TEXTCOLOR",   (0,0), (0,-1), white),
    ("BACKGROUND",  (1,0), (1,-1), white),
    ("BOX",         (0,0), (-1,-1), 0.5, LINE),
    ("INNERGRID",   (0,0), (-1,-1), 0.5, LINE),
    ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 10),
    ("RIGHTPADDING",(0,0), (-1,-1), 10),
    ("TOPPADDING",  (0,0), (-1,-1), 7),
    ("BOTTOMPADDING",(0,0),(-1,-1), 7),
]))
story.append(tech)

# ===== PAGE 5: ПОСЛЕДНА РАБОТА =====
story.append(PageBreak())
story.append(Paragraph("Какво сме свършили наскоро", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "Последна сесия работа — само additive, нула пипане по критичните потоци "
    "(OCR/YOLO, релета, snapshot, резервации, Hikvision, fuzzy gating).", MUTED_S))
story.append(Spacer(1, 4*mm))

commits = Table([
    [chip("087a50d", TEAL),
     Paragraph("<b>i18n корекция</b><br/>"
               '<font color="#475569" size="9">Поправен typo в bg.ts; добавени преводи за '
               'health uptime съобщенията.</font>', BODY)],
    [chip("135cde5", TEAL),
     Paragraph("<b>Operator достъп до временни credentials</b><br/>"
               '<font color="#475569" size="9">API endpoint adminOnly → writeAccess; '
               'App.tsx route opOrAbove; sidebar item видим за operator.</font>', BODY)],
    [chip("570b94c", TEAL),
     Paragraph("<b>Мобилен POC — layout + controls</b><br/>"
               '<font color="#475569" size="9">app-layout с responsive header (pl-16 md:pl-6) '
               'и адаптивни paddings; премахнат вложен p-6 в controls.tsx.</font>', BODY)],
    [chip("f56b6c1", TEAL),
     Paragraph("<b>Мобилно — останалите 5 страници</b><br/>"
               '<font color="#475569" size="9">Reservations, vehicles, temp-credentials: '
               'dialogs w-[95vw] max-h-[90vh], grid-cols-1 sm:grid-cols-N, vehicles tiles '
               '2 col на мобилен / 3 на desktop, stats bar flex-wrap, селекторите w-full на mobile.</font>', BODY)],
    [chip("c5ff32d", GOLD),
     Paragraph("<b>🔒 Security hardening (B+C+D+F+G)</b><br/>"
               '<font color="#475569" size="9">Helmet headers, rate-limit на /auth/login (10/15мин) '
               'и /auth/refresh (60/15мин), env-driven CORS allowlist, trust proxy, '
               'затворени Docker хост портове (postgres + backend → expose), '
               'qs CVE-2026-8723 fix, warning при липсващ JWT_SECRET в production.</font>', BODY)],
], colWidths=[22*mm, A4[0]-36*mm-22*mm])
commits.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (-1,-1), white),
    ("LINEBELOW",   (0,0), (-1,-2), 0.4, LINE),
    ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
    ("RIGHTPADDING",(0,0), (-1,-1), 10),
    ("TOPPADDING",  (0,0), (-1,-1), 8),
    ("BOTTOMPADDING",(0,0),(-1,-1), 8),
]))
story.append(commits)
story.append(Spacer(1, 6*mm))

# ===== PAGE 6: SECURITY POSTURE =====
story.append(PageBreak())
story.append(Paragraph("Сигурност — текущо състояние", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))

story.append(Paragraph("Какво вече е защитено", H2))
sec_done = Table([
    [chip("✓", GREEN), Paragraph("<b>Security headers (Helmet)</b> — X-Frame-Options, "
        "XSS, HSTS, Referrer-Policy, COOP, nosniff", BODY)],
    [chip("✓", GREEN), Paragraph("<b>Brute-force защита</b> — rate-limit на login (10 опита / "
        "15 мин на IP) и refresh (60 / 15 мин)", BODY)],
    [chip("✓", GREEN), Paragraph("<b>CORS allowlist</b> — env-driven (CORS_ALLOWED_ORIGINS), "
        "backwards compatible", BODY)],
    [chip("✓", GREEN), Paragraph("<b>Затворени Docker портове</b> — postgres (5432) и backend "
        "(8080) вече само вътре в compose мрежата", BODY)],
    [chip("✓", GREEN), Paragraph("<b>qs CVE-2026-8723</b> — fix чрез pnpm override към 6.15.2", BODY)],
    [chip("✓", GREEN), Paragraph("<b>JWT secret warning</b> — loud log в production ако се "
        "ползва dev fallback", BODY)],
    [chip("✓", GREEN), Paragraph("<b>Refresh token ротация</b> — 15 мин access, 7 дни refresh, "
        "DB-проследен", BODY)],
    [chip("✓", GREEN), Paragraph("<b>Zod валидация</b> на всички auth endpoints", BODY)],
    [chip("✓", GREEN), Paragraph("<b>Role-based access</b> — adminOnly за смяна на устройства; "
        "operator само за гост-достъп", BODY)],
], colWidths=[16*mm, A4[0]-36*mm-16*mm])
sec_done.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING",  (0,0), (-1,-1), 5),
    ("BOTTOMPADDING",(0,0),(-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 0),
    ("RIGHTPADDING",(1,0), (1,-1), 4),
]))
story.append(sec_done)
story.append(Spacer(1, 5*mm))

story.append(Paragraph("Какво остава в backlog", H2))
sec_todo = Table([
    [chip("A", AMBER), Paragraph("<b>HTTPS / TLS на nginx</b> — изисква решение за сертификат "
        "(Let's Encrypt vs self-signed). Без HTTPS паролите летят в чист вид при достъп извън LAN.", BODY)],
    [chip("E", AMBER), Paragraph("<b>bcrypt пароли</b> — в момента SHA-256 със сол. При изтекла "
        "база е счупимо. Препоръка: dual-hash миграция (нови = bcrypt, стари автоматично "
        "пресмятат при login).", BODY)],
    [chip("?", MUTED), Paragraph("<b>2FA / Google Authenticator</b> — отложено по заявка на "
        "потребителя. Може да се добави opt-in за admin роля без UX тежест за оператори.", BODY)],
], colWidths=[16*mm, A4[0]-36*mm-16*mm])
sec_todo.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("TOPPADDING",  (0,0), (-1,-1), 5),
    ("BOTTOMPADDING",(0,0),(-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 0),
    ("RIGHTPADDING",(1,0), (1,-1), 4),
]))
story.append(sec_todo)

# ===== PAGE 7: DEPLOYMENT + ROADMAP =====
story.append(PageBreak())
story.append(Paragraph("Deployment и експлоатация", H1))
story.append(HRFlowable(width="20%", thickness=2, color=TEAL, spaceBefore=0, spaceAfter=4*mm))

story.append(stat_row([
    ("6.5.4.254", "production host"),
    (":3000", "единствен публичен порт"),
    ("main", "GitHub branch"),
    ("auto-push", "след всеки task"),
]))
story.append(Spacer(1, 5*mm))

story.append(Paragraph("Deploy flow", H2))
story.append(card("Стандартен deploy цикъл", [
    Paragraph(
        '<font name="DejaVu-Mono" size="9">'
        'git pull<br/>'
        'docker compose down<br/>'
        'docker compose up -d --build'
        '</font>', BODY),
    Spacer(1, 2*mm),
    Paragraph(
        "Миграциите се пускат автоматично от migrate сервиса преди backend-а. "
        ".env.docker файлът (symlink към .env) държи всички тайни.", BODY),
]))
story.append(Spacer(1, 6*mm))

story.append(Paragraph("Какво следва (предложения)", H2))
roadmap = Table([
    [Paragraph('<b>📈 Приоритет 1</b>', BODY),
     Paragraph("Включване на <b>HTTPS</b> в nginx (commented HTTPS block + Let's Encrypt). "
               "Това е най-голямата дупка останала.", BODY)],
    [Paragraph('<b>📈 Приоритет 2</b>', BODY),
     Paragraph("Миграция на пароли към <b>bcrypt</b> с dual-hash стратегия. "
               "Защитава ако базата изтече.", BODY)],
    [Paragraph('<b>📈 Приоритет 3</b>', BODY),
     Paragraph("<b>2FA за admin</b> — opt-in TOTP. Лесна добавка, голяма стойност за главния акаунт.", BODY)],
    [Paragraph('<b>💡 Идея</b>', BODY),
     Paragraph("Мобилно <b>PWA</b> wrapping — операторите вече имат responsive UI; "
               "install-on-home-screen ще даде native-like преживяване.", BODY)],
    [Paragraph('<b>💡 Идея</b>', BODY),
     Paragraph("<b>Push notifications</b> за критични events (отворена врата извън часовете, "
               "нова ANPR неразпозната кола, неуспешен PIN x пъти).", BODY)],
], colWidths=[28*mm, A4[0]-36*mm-28*mm])
roadmap.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (0,-1), CARD),
    ("LINEBELOW",   (0,0), (-1,-2), 0.4, LINE),
    ("VALIGN",      (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING", (0,0), (-1,-1), 10),
    ("RIGHTPADDING",(0,0), (-1,-1), 10),
    ("TOPPADDING",  (0,0), (-1,-1), 8),
    ("BOTTOMPADDING",(0,0),(-1,-1), 8),
]))
story.append(roadmap)
story.append(Spacer(1, 10*mm))

# Footer signature
sig = Table([[
    Paragraph(
        '<font color="#64748B" size="9">Този отчет е генериран автоматично от Replit Agent '
        'на база реалното състояние на git хранилището. За въпроси и следващи стъпки — '
        'просто пиши в чата.</font>', BODY)
]], colWidths=[A4[0]-36*mm])
sig.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (-1,-1), NAVY),
    ("LEFTPADDING", (0,0), (-1,-1), 12),
    ("RIGHTPADDING",(0,0), (-1,-1), 12),
    ("TOPPADDING",  (0,0), (-1,-1), 10),
    ("BOTTOMPADDING",(0,0),(-1,-1), 10),
]))
story.append(sig)

# ─── Build ───────────────────────────────────────────────────────────────────
doc.build(story)
print(f"OK -> {OUT_PATH}")
