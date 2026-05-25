#!/usr/bin/env python3
"""Villa Access Control — рекламна брошура за клиенти (BG)."""
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    PageBreak, Table, TableStyle, NextPageTemplate,
)
from reportlab.platypus.flowables import HRFlowable

# ─── Fonts (Cyrillic) ────────────────────────────────────────────────────────
pdfmetrics.registerFont(TTFont("DejaVu",      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

# ─── Palette — premium dark + warm gold ──────────────────────────────────────
NAVY    = HexColor("#0A1628")   # cover & accents
DEEP    = HexColor("#102841")
TEAL    = HexColor("#14B8A6")
GOLD    = HexColor("#E0B962")
GOLD_D  = HexColor("#B8923C")
CREAM   = HexColor("#FAF7F2")
INK     = HexColor("#0F172A")
MUTED   = HexColor("#64748B")
LIGHT   = HexColor("#F8FAFC")
CARD    = HexColor("#F4F1EC")
LINE    = HexColor("#D6CFC2")
GREEN   = HexColor("#16A34A")

# ─── Styles ──────────────────────────────────────────────────────────────────
H1 = ParagraphStyle("H1", fontName="DejaVu-Bold", fontSize=28, leading=34,
                     textColor=NAVY, spaceAfter=4*mm, spaceBefore=0)
H2 = ParagraphStyle("H2", fontName="DejaVu-Bold", fontSize=17, leading=23,
                     textColor=NAVY, spaceAfter=3*mm, spaceBefore=6*mm)
H3 = ParagraphStyle("H3", fontName="DejaVu-Bold", fontSize=13, leading=18,
                     textColor=NAVY, spaceAfter=2*mm, spaceBefore=2*mm)
BODY = ParagraphStyle("Body", fontName="DejaVu", fontSize=11, leading=16,
                      textColor=INK, spaceAfter=2*mm, alignment=TA_LEFT)
LEAD = ParagraphStyle("Lead", fontName="DejaVu", fontSize=13, leading=20,
                      textColor=DEEP, spaceAfter=4*mm)
MUTED_S = ParagraphStyle("Muted", fontName="DejaVu", fontSize=9.5, leading=13,
                          textColor=MUTED)
QUOTE = ParagraphStyle("Quote", fontName="DejaVu", fontSize=14, leading=22,
                       textColor=NAVY, alignment=TA_CENTER, spaceAfter=3*mm)

# Cover styles
COVER_KICKER = ParagraphStyle("CK", fontName="DejaVu-Bold", fontSize=11, leading=16,
                               textColor=GOLD, alignment=TA_LEFT)
COVER_TITLE  = ParagraphStyle("CT", fontName="DejaVu-Bold", fontSize=52, leading=58,
                               textColor=white, alignment=TA_LEFT)
COVER_SUB    = ParagraphStyle("CS", fontName="DejaVu", fontSize=18, leading=26,
                               textColor=HexColor("#CBD5E1"), alignment=TA_LEFT)
COVER_FOOT   = ParagraphStyle("CF", fontName="DejaVu", fontSize=10, leading=14,
                               textColor=HexColor("#94A3B8"), alignment=TA_LEFT)
COVER_BIG    = ParagraphStyle("CB", fontName="DejaVu-Bold", fontSize=80, leading=90,
                               textColor=GOLD, alignment=TA_CENTER)
COVER_BIG_LBL= ParagraphStyle("CBL", fontName="DejaVu", fontSize=12, leading=16,
                               textColor=white, alignment=TA_CENTER)

OUT_PATH = "exports/VillaAccess_Brochure_BG.pdf"

# ─── Page decorations ────────────────────────────────────────────────────────
def cover_bg(canvas, doc):
    w, h = A4
    canvas.saveState()
    # Full navy gradient look via overlay rects
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    # Diagonal gold accent stripe (top right corner)
    canvas.setFillColor(GOLD)
    p = canvas.beginPath()
    p.moveTo(w, h); p.lineTo(w-60*mm, h); p.lineTo(w, h-60*mm); p.close()
    canvas.drawPath(p, fill=1, stroke=0)
    canvas.setFillColor(NAVY)
    p2 = canvas.beginPath()
    p2.moveTo(w, h-2*mm); p2.lineTo(w-55*mm, h-2*mm); p2.lineTo(w-2*mm, h-55*mm); p2.close()
    canvas.drawPath(p2, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    p3 = canvas.beginPath()
    p3.moveTo(w-2*mm, h-12*mm); p3.lineTo(w-40*mm, h-12*mm); p3.lineTo(w-12*mm, h-40*mm); p3.lineTo(w-2*mm, h-40*mm); p3.close()
    canvas.drawPath(p3, fill=1, stroke=0)
    # Bottom gold band
    canvas.setFillColor(GOLD)
    canvas.rect(0, 0, w, 12*mm, fill=1, stroke=0)
    canvas.setFillColor(NAVY)
    canvas.setFont("DejaVu-Bold", 9)
    canvas.drawString(18*mm, 4.5*mm, "ИНТЕЛИГЕНТЕН ДОСТЪП  •  АВТОМАТИЗАЦИЯ  •  СИГУРНОСТ")
    canvas.restoreState()

def content_bg(canvas, doc):
    w, h = A4
    canvas.saveState()
    # Subtle top accent
    canvas.setFillColor(NAVY)
    canvas.rect(0, h-10*mm, w, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, h-10*mm, w, 1.2*mm, fill=1, stroke=0)
    canvas.setFont("DejaVu-Bold", 9); canvas.setFillColor(white)
    canvas.drawString(18*mm, h-7*mm, "VILLA ACCESS CONTROL")
    canvas.setFont("DejaVu", 8); canvas.setFillColor(HexColor("#94A3B8"))
    canvas.drawRightString(w-18*mm, h-7*mm, "Интелигентен достъп за вили и комплекси")
    # Footer
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, 10*mm-1.2*mm, w, 1.2*mm, fill=1, stroke=0)
    canvas.setFont("DejaVu", 8); canvas.setFillColor(HexColor("#94A3B8"))
    canvas.drawString(18*mm, 4*mm, "villaaccess  •  поискайте демонстрация")
    canvas.drawRightString(w-18*mm, 4*mm, f"стр. {doc.page-1}")
    canvas.restoreState()

def section_bg(canvas, doc):
    """Full-bleed dark page (for stats/showcase)."""
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, h-1.2*mm, w, 1.2*mm, fill=1, stroke=0)
    canvas.rect(0, 0, w, 1.2*mm, fill=1, stroke=0)
    canvas.restoreState()

# ─── Document setup ──────────────────────────────────────────────────────────
doc = BaseDocTemplate(OUT_PATH, pagesize=A4,
                      leftMargin=18*mm, rightMargin=18*mm,
                      topMargin=16*mm, bottomMargin=16*mm,
                      title="Villa Access Control — Интелигентен достъп",
                      author="Villa Access Control")

cover_frame   = Frame(18*mm, 18*mm, A4[0]-36*mm, A4[1]-36*mm, id="cover",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
content_frame = Frame(18*mm, 16*mm, A4[0]-36*mm, A4[1]-32*mm, id="content",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
section_frame = Frame(18*mm, 18*mm, A4[0]-36*mm, A4[1]-36*mm, id="section",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

doc.addPageTemplates([
    PageTemplate(id="Cover",   frames=[cover_frame],   onPage=cover_bg),
    PageTemplate(id="Content", frames=[content_frame], onPage=content_bg),
    PageTemplate(id="Section", frames=[section_frame], onPage=section_bg),
])

# ─── Builders ────────────────────────────────────────────────────────────────
def benefit_card(emoji, title, body, bg=CARD, accent=GOLD):
    inner = [
        Paragraph(f'<font size="22">{emoji}</font>', BODY),
        Spacer(1, 2*mm),
        Paragraph(f"<b>{title}</b>", H3),
        Paragraph(f'<font color="#475569">{body}</font>', BODY),
    ]
    t = Table([[inner]], colWidths=[None])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg),
        ("LINEABOVE",  (0,0), (-1,-1), 2, accent),
        ("LEFTPADDING",(0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0),(-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 10),
        ("BOTTOMPADDING",(0,0),(-1,-1),12),
        ("VALIGN",     (0,0), (-1,-1), "TOP"),
    ]))
    return t

def benefit_grid(items, cols=2):
    """items = [(emoji, title, body), ...]"""
    cells = [benefit_card(*it) for it in items]
    rows = []
    for i in range(0, len(cells), cols):
        row = cells[i:i+cols]
        while len(row) < cols:
            row.append("")
        rows.append(row)
    colw = (A4[0]-36*mm - (cols-1)*4*mm) / cols
    t = Table(rows, colWidths=[colw]*cols)
    t.setStyle(TableStyle([
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING",(0,0), (-1,-1), 0),
        ("TOPPADDING",  (0,0), (-1,-1), 2*mm),
        ("BOTTOMPADDING",(0,0),(-1,-1), 2*mm),
    ]))
    return t

def step(num, title, body):
    """Numbered step with big circle number."""
    circle_para = Paragraph(
        f'<font name="DejaVu-Bold" size="28" color="#E0B962">{num}</font>', BODY)
    text = [
        Paragraph(f"<b>{title}</b>", H3),
        Paragraph(f'<font color="#475569">{body}</font>', BODY),
    ]
    t = Table([[circle_para, text]], colWidths=[16*mm, A4[0]-36*mm-16*mm])
    t.setStyle(TableStyle([
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING",(0,0), (-1,-1), 0),
        ("TOPPADDING",  (0,0), (-1,-1), 3),
        ("BOTTOMPADDING",(0,0),(-1,-1), 8),
    ]))
    return t

def pain_card(emoji, title, body):
    return benefit_card(emoji, title, body, bg=HexColor("#FEF2F2"), accent=HexColor("#DC2626"))

def big_stat(big, label, sub=None):
    """Used on dark pages."""
    cells = [
        Paragraph(f'<font name="DejaVu-Bold" size="56" color="#E0B962">{big}</font>',
                  ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=64)),
        Paragraph(f'<font color="#FFFFFF" size="11"><b>{label}</b></font>',
                  ParagraphStyle("XL", parent=BODY, alignment=TA_CENTER)),
    ]
    if sub:
        cells.append(Paragraph(f'<font color="#94A3B8" size="9">{sub}</font>',
                  ParagraphStyle("XS", parent=BODY, alignment=TA_CENTER)))
    return cells

# ─── Content ─────────────────────────────────────────────────────────────────
story = []

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 1 — COVER
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(Spacer(1, 30*mm))
story.append(Paragraph("ИНТЕЛИГЕНТЕН ДОСТЪП", COVER_KICKER))
story.append(Spacer(1, 4*mm))
story.append(Paragraph("Вилата<br/>работи<br/>сама.", COVER_TITLE))
story.append(Spacer(1, 12*mm))
story.append(Paragraph(
    "AI система за автоматичен достъп<br/>до вили, апартаменти и комплекси —<br/>"
    "без оператор, без ключове, без обаждания.",
    COVER_SUB))
story.append(Spacer(1, 50*mm))
story.append(Paragraph(
    '<font color="#E0B962"><b>ВАШИТЕ ГОСТИ ВЛИЗАТ САМИ.</b></font><br/>'
    "Резервацията се прави. Системата издава PIN или разпознава колата. "
    "Бариерата се отваря автоматично.", COVER_FOOT))

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 2 — ПРОБЛЕМЪТ
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(NextPageTemplate("Content"))
story.append(PageBreak())

story.append(Paragraph("Познавате ли тези ситуации?", H1))
story.append(HRFlowable(width="20%", thickness=2, color=GOLD, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "Управлението на достъпа до вила или комплекс отнема време, нерви и пари. "
    "Всеки от тези моменти ви е струвал репутация или поне час сън.", LEAD))
story.append(Spacer(1, 3*mm))

story.append(benefit_grid([
    ("📞", "Обаждания в 2 през нощта",
     "Гост пристига късно, портата е затворена, охраната спи. "
     "Звънят на вас. Всеки път."),
    ("🔑", "Загубени или копирани ключове",
     "Раздавате ключове на чистачка, техник, гост, наемател. "
     "Никога не знаете кой колко копия има."),
    ("👮", "24/7 охранител = ~3000 лв/мес",
     "Един човек на портала струва колкото една заплата. "
     "За какво — да отваря бариера 5 пъти на ден?"),
    ("📋", "Никаква история",
     "Кой влезе вчера в 22:30? Кой пусна камиона? "
     "Никой не помни, никой не е записал."),
    ("🚗", "Зареждане на номера на ръка",
     "Гостът праща снимка на личната карта на колата, "
     "някой ги вкарва в Excel… ако се сети."),
    ("⏰", "Координация на смяна на гости",
     "Излизащият още не е тръгнал, идващият звъни от паркинга. "
     "Хаос всеки уикенд."),
], cols=2))

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 3 — РЕШЕНИЕТО
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(PageBreak())
story.append(Paragraph("Решението е една система.", H1))
story.append(HRFlowable(width="20%", thickness=2, color=GOLD, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "<b>Villa Access Control</b> заменя охранителя, ключовете и Excel-а с една "
    "интелигентна платформа. Свързва камерите, бариерите, ключалките и резервационната "
    "ви система. Работи 24/7. Не пропуска нищо.", LEAD))
story.append(Spacer(1, 4*mm))

story.append(Paragraph("Как работи — 3 стъпки", H2))
story.append(step("1", "Гостът прави резервация",
    "Влизате го в системата (или се закача към booking-а ви). Системата автоматично "
    "генерира уникален PIN код и приема номера на колата му за разрешен достъп — "
    "САМО за периода на престоя."))
story.append(step("2", "Гостът пристига — системата го разпознава",
    "AI камера на бариерата чете регистрационния номер за под 1 секунда. Ако съвпада "
    "с резервация — бариерата се отваря автоматично. Без обаждания, без чакане."))
story.append(step("3", "Гостът влиза с PIN",
    "Smart ключалката на вилата приема личния му PIN. След датата на напускане PIN-ът "
    "престава да работи автоматично. Никой не може да се върне 'случайно'."))

story.append(Spacer(1, 6*mm))
quote_tbl = Table([[Paragraph(
    '«Всеки гост получава достъп — но <b>само неговия достъп, '
    'само за неговото време</b>.»', QUOTE)]],
    colWidths=[A4[0]-36*mm])
quote_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), CARD),
    ("LINEABOVE",  (0,0), (-1,-1), 2, GOLD),
    ("LINEBELOW",  (0,0), (-1,-1), 2, GOLD),
    ("TOPPADDING", (0,0), (-1,-1), 14),
    ("BOTTOMPADDING",(0,0),(-1,-1),14),
    ("LEFTPADDING",(0,0), (-1,-1), 20),
    ("RIGHTPADDING",(0,0),(-1,-1), 20),
]))
story.append(quote_tbl)

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 4 — STATS (dark page)
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(NextPageTemplate("Section"))
story.append(PageBreak())

story.append(Spacer(1, 25*mm))
story.append(Paragraph(
    '<font color="#E0B962" size="11"><b>ИЗМЕРИМИЯТ ЕФЕКТ</b></font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER)))
story.append(Spacer(1, 3*mm))
story.append(Paragraph(
    '<font color="#FFFFFF" size="32"><b>Числа, които променят бизнеса.</b></font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=40)))
story.append(Spacer(1, 18*mm))

stat_tbl = Table([[
    big_stat("0", "обаждания в 2 през нощта", "автоматичен достъп 24/7"),
    big_stat("&lt;1с", "за разпознаване на номер", "AI камера + ANPR"),
    big_stat("100%", "история на влизанията", "всеки event с timestamp"),
]], colWidths=[(A4[0]-36*mm)/3]*3)
stat_tbl.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING",  (0,0), (-1,-1), 4),
    ("RIGHTPADDING", (0,0), (-1,-1), 4),
]))
story.append(stat_tbl)
story.append(Spacer(1, 14*mm))

stat_tbl2 = Table([[
    big_stat("~3000лв", "месечна икономия", "вместо нощен охранител"),
    big_stat("0", "загубени ключове", "всичко е цифрово"),
    big_stat("∞", "брой гости", "паралелно, без объркване"),
]], colWidths=[(A4[0]-36*mm)/3]*3)
stat_tbl2.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING",  (0,0), (-1,-1), 4),
    ("RIGHTPADDING", (0,0), (-1,-1), 4),
]))
story.append(stat_tbl2)

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 5 — ЗА КОГО
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(NextPageTemplate("Content"))
story.append(PageBreak())

story.append(Paragraph("За кого е създадена", H1))
story.append(HRFlowable(width="20%", thickness=2, color=GOLD, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "Системата е готова да обслужва един обект или цяла мрежа от стотици. "
    "Скалира се без преконфигурация.", LEAD))
story.append(Spacer(1, 3*mm))

story.append(benefit_grid([
    ("🏖", "Вили под наем (Airbnb / Booking)",
     "Гостът пристига сам. Никой не го чака с ключ. PIN-ът се изтрива "
     "автоматично след напускането."),
    ("🏘", "Затворени комплекси",
     "Постоянните живущи имат свои номера; гостите им се одобряват временно. "
     "Куриерите и техниците — еднократен код."),
    ("🏨", "Бутикови хотели и гост вили",
     "Само ресепцията управлява всичко от един екран. Без операторска зала, "
     "без 24-часов човек на портала."),
    ("🚪", "Жилищни сгради и паркинги",
     "Резидентите си отварят с разпознаване на номер. Доставките и таксито — "
     "временен достъп от мениджъра."),
], cols=2))

story.append(Spacer(1, 4*mm))
story.append(Paragraph("Какво включва системата", H2))

modules = [
    ("📷", "AI разпознаване на номера (ANPR)",
     "Камера + изкуствен интелект четат всеки номер. Сравняват с резервациите. "
     "Решават дали да отворят."),
    ("🔐", "Smart ключалки (Tuya / WiFi)",
     "Уникален PIN за всеки гост, активен само за периода на резервацията. "
     "Автоматично изтриване."),
    ("📞", "Интеграция с домофони и бариери",
     "Релейно управление на съществуващото ви оборудване. Не сменяте всичко — "
     "ние се закачаме за вашето."),
    ("📅", "Управление на резервации",
     "Един екран за всички гости — име, период, кола, телефон. PIN-ът идва "
     "автоматично с резервацията."),
    ("⏱", "Временен достъп за куриери и техници",
     "Издавате еднократен код за конкретен час. Активен 30 мин — после "
     "изтича от само себе си."),
    ("📊", "Пълна история и одит",
     "Всяко влизане, всеки PIN, всеки отказ — записани с дата и час. "
     "Можете да докажете кой кога е бил."),
    ("👥", "Множество роли",
     "Администратор вижда всичко. Оператор само издава достъпи. "
     "Охрана само следи. Чисто и контролирано."),
    ("📱", "Работи на телефон",
     "Целият интерфейс е оптимизиран за мобилен. Управление от паркинга, "
     "от плажа, от вкъщи."),
]
story.append(benefit_grid(modules, cols=2))

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 6 — СИГУРНОСТ + ТЕХНОЛОГИЯ (накратко)
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(PageBreak())
story.append(Paragraph("Сигурност от първия ден", H1))
story.append(HRFlowable(width="20%", thickness=2, color=GOLD, spaceBefore=0, spaceAfter=4*mm))
story.append(Paragraph(
    "Управлявате достъпа до домовете на хората — затова всеки слой е защитен. "
    "Системата следва корпоративни стандарти за сигурност.", LEAD))

sec_items = [
    ("🛡", "Криптирана комуникация",
     "HTTPS с TLS сертификати. Никой не може да подслуша връзката между ваш "
     "телефон и системата."),
    ("🔑", "Защитени пароли и сесии",
     "Кратки сесии с автоматично обновяване. Защита срещу опити за "
     "налучкване на парола."),
    ("🚫", "Затворена мрежа",
     "Камерите и базата данни не са достъпни от интернет. Само "
     "потребителският интерфейс е публичен — и той зад HTTPS."),
    ("👤", "Роли и разрешения",
     "Всеки потребител вижда само това, което му е нужно. "
     "Чувствителните действия са admin-only."),
    ("📜", "Пълен одит",
     "Всяка операция — кой, какво, кога. Можете да докажете действия "
     "ретроактивно при нужда."),
    ("🇪🇺", "GDPR-friendly",
     "Данните живеят на ваш сървър, под ваш контрол. "
     "Никакво облако от трети страни без съгласие."),
]
story.append(Spacer(1, 2*mm))
story.append(benefit_grid(sec_items, cols=2))

story.append(Spacer(1, 6*mm))
story.append(Paragraph("Технология", H2))
tech_para = Paragraph(
    "Системата е изградена с модерни и доказани технологии: <b>изкуствен интелект</b> "
    "за разпознаване на номера, <b>облачни smart ключалки</b> за управление на PIN-ове, "
    "<b>уеб интерфейс</b> работещ на компютър, таблет и телефон. Хоства се на вашата "
    "инфраструктура или на наш мениджиран сървър — вие решавате.", BODY)
tech_box = Table([[tech_para]], colWidths=[A4[0]-36*mm])
tech_box.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), NAVY),
    ("TEXTCOLOR",  (0,0), (-1,-1), white),
    ("LINEABOVE",  (0,0), (-1,-1), 2, GOLD),
    ("LEFTPADDING",(0,0), (-1,-1), 14),
    ("RIGHTPADDING",(0,0),(-1,-1), 14),
    ("TOPPADDING", (0,0), (-1,-1), 12),
    ("BOTTOMPADDING",(0,0),(-1,-1), 12),
]))
# Need to wrap with white text style — easier: use HTML font color
tech_box2 = Table([[Paragraph(
    '<font color="#FFFFFF">Системата е изградена с модерни и доказани технологии: '
    '<b>изкуствен интелект</b> за разпознаване на номера, <b>облачни smart ключалки</b> '
    'за управление на PIN-ове, <b>уеб интерфейс</b> работещ на компютър, таблет и телефон. '
    'Хоства се на вашата инфраструктура или на наш мениджиран сървър — вие решавате.</font>',
    BODY)]], colWidths=[A4[0]-36*mm])
tech_box2.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), NAVY),
    ("LINEABOVE",  (0,0), (-1,-1), 2, GOLD),
    ("LEFTPADDING",(0,0), (-1,-1), 14),
    ("RIGHTPADDING",(0,0),(-1,-1), 14),
    ("TOPPADDING", (0,0), (-1,-1), 12),
    ("BOTTOMPADDING",(0,0),(-1,-1), 12),
]))
story.append(tech_box2)

# ╔═════════════════════════════════════════════════════════════════════════════
# ║ PAGE 7 — CALL TO ACTION
# ╚═════════════════════════════════════════════════════════════════════════════
story.append(NextPageTemplate("Section"))
story.append(PageBreak())

story.append(Spacer(1, 35*mm))
story.append(Paragraph(
    '<font color="#E0B962" size="11"><b>ГОТОВИ ЛИ СТЕ?</b></font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER)))
story.append(Spacer(1, 4*mm))
story.append(Paragraph(
    '<font color="#FFFFFF" size="36"><b>Дайте на вилата си<br/>дигитален портиер.</b></font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=46)))
story.append(Spacer(1, 10*mm))
story.append(Paragraph(
    '<font color="#CBD5E1" size="13">Един час за демонстрация.<br/>'
    'Една седмица за инсталация.<br/>'
    'Цял живот спокоен сън.</font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=22)))
story.append(Spacer(1, 25*mm))

# CTA card
cta_inner = [
    Paragraph(
        '<font color="#0A1628" size="14"><b>Поискайте безплатна демонстрация</b></font>',
        ParagraphStyle("X", parent=BODY, alignment=TA_CENTER)),
    Spacer(1, 4*mm),
    Paragraph(
        '<font color="#0A1628" size="11">Показваме ви системата на живо — с вашите камери, '
        'вашите ключалки, вашите вили. Без ангажимент.</font>',
        ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=16)),
    Spacer(1, 6*mm),
    Paragraph(
        '<font color="#0A1628" size="14"><b>📧 ваш-имейл@example.com</b></font><br/>'
        '<font color="#0A1628" size="14"><b>📞 +359 88 123 4567</b></font>',
        ParagraphStyle("X", parent=BODY, alignment=TA_CENTER, leading=22)),
]
cta = Table([[cta_inner]], colWidths=[A4[0]-66*mm])
cta.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), GOLD),
    ("LEFTPADDING",(0,0), (-1,-1), 24),
    ("RIGHTPADDING",(0,0),(-1,-1), 24),
    ("TOPPADDING", (0,0), (-1,-1), 22),
    ("BOTTOMPADDING",(0,0),(-1,-1), 22),
    ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
    ("ALIGN",      (0,0), (-1,-1), "CENTER"),
]))
cta_wrap = Table([[cta]], colWidths=[A4[0]-36*mm])
cta_wrap.setStyle(TableStyle([
    ("ALIGN",  (0,0), (-1,-1), "CENTER"),
    ("LEFTPADDING",(0,0), (-1,-1), 0),
    ("RIGHTPADDING",(0,0),(-1,-1), 0),
]))
story.append(cta_wrap)
story.append(Spacer(1, 20*mm))
story.append(Paragraph(
    '<font color="#94A3B8" size="9">VILLA ACCESS CONTROL  •  '
    f'{datetime.now().strftime("%Y")}  •  Всички права запазени.</font>',
    ParagraphStyle("X", parent=BODY, alignment=TA_CENTER)))

# ─── Build ───────────────────────────────────────────────────────────────────
doc.build(story)
print(f"OK -> {OUT_PATH}")
