#!/usr/bin/env python3
"""Generate a 1280x800 Chrome Web Store screenshot (no alpha) for Gmail2Drive."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 800
BLUE = (26, 115, 232)
INK = (32, 33, 36)
MUTED = (95, 99, 104)
CARD = (255, 255, 255)

ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

# Background: soft vertical gradient (light blue -> white)
bg = Image.new("RGB", (W, H), "white")
top = (232, 240, 254)
bot = (255, 255, 255)
for y in range(H):
    t = y / H
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    for x in range(W):
        bg.putpixel((x, y), (r, g, b))

draw = ImageDraw.Draw(bg)

# Logo
logo = Image.open("assets/design/Gmail2Drive-color.png").convert("RGBA")
logo.thumbnail((150, 150), Image.LANCZOS)
bg.paste(logo, ((W - logo.width) // 2, 90), logo)

# Title + tagline
title_f = font(ARIAL_BOLD, 60)
tag_f = font(ARIAL, 28)

def center_text(y, text, f, fill):
    w = draw.textlength(text, font=f)
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)

center_text(255, "Gmail2Drive", title_f, INK)
center_text(335, "Save Gmail emails as PDFs — with attachments — to Google Drive", tag_f, MUTED)

# Feature card
cx0, cy0, cx1, cy1 = 240, 420, 1040, 720
draw.rounded_rectangle([cx0, cy0, cx1, cy1], radius=20, fill=CARD, outline=(232, 234, 237), width=1)

feat_f = font(ARIAL, 26)
features = [
    "One folder per conversation, named after the subject",
    "All messages combined into a single tidy PDF",
    "Attachments saved alongside, duplicates removed",
    "Choose any Drive folder, including Shared Drives",
]
y = cy0 + 42
for line in features:
    # check mark
    draw.ellipse([cx0 + 40, y + 2, cx0 + 68, y + 30], fill=(232, 245, 233))
    draw.line([cx0 + 47, y + 16, cx0 + 53, y + 23], fill=(52, 168, 83), width=4)
    draw.line([cx0 + 53, y + 23, cx0 + 63, y + 9], fill=(52, 168, 83), width=4)
    draw.text((cx0 + 88, y + 2), line, font=feat_f, fill=INK)
    y += 62

bg.save("assets/design/screenshot-1.png", "PNG")
print("Wrote assets/design/screenshot-1.png", bg.size)
