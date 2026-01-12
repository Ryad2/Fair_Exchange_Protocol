#!/usr/bin/env python3
"""
Diagramme expliquant le mécanisme de sponsoring dans le système SOX
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Dimensions
WIDTH = 1400
HEIGHT = 1000
MARGIN = 50

# Couleurs
COLOR_BG = (255, 255, 255)
COLOR_OPTIMISTIC = (52, 152, 219)  # Bleu
COLOR_BUYER_SPONSOR = (46, 204, 113)  # Vert
COLOR_VENDOR_SPONSOR = (241, 196, 15)  # Jaune
COLOR_CONTRACT = (155, 89, 182)  # Violet
COLOR_TEXT = (44, 62, 80)  # Gris foncé
COLOR_ARROW = (127, 140, 141)  # Gris
COLOR_SUCCESS = (39, 174, 96)  # Vert foncé
COLOR_DISPUTE = (231, 76, 60)  # Rouge

# Créer l'image
img = Image.new('RGB', (WIDTH, HEIGHT), COLOR_BG)
draw = ImageDraw.Draw(img)

# Charger les polices
try:
    font_title = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
    font_subtitle = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    font_text = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
    font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
except:
    font_title = ImageFont.load_default()
    font_subtitle = ImageFont.load_default()
    font_text = ImageFont.load_default()
    font_small = ImageFont.load_default()

# Titre
draw.text((WIDTH//2, 30), "Mécanisme de Sponsoring - Système SOX", 
          fill=COLOR_TEXT, font=font_title, anchor="mm")

# ========== PHASE 1: SPONSORING OPTIMISTIC ==========
y1 = 120
x_left = 150
x_right = WIDTH - 150

# Box: Contrat non sponsorisé
box1_y = y1
box1_w = 300
box1_h = 80
draw.rounded_rectangle([x_left - box1_w//2, box1_y, x_left + box1_w//2, box1_y + box1_h],
                       radius=10, fill=(240, 240, 240), outline=COLOR_TEXT, width=2)
draw.text((x_left, box1_y + 20), "Contrat Accepté", 
          fill=COLOR_TEXT, font=font_subtitle, anchor="mm")
draw.text((x_left, box1_y + 50), "(Non sponsorisé)", 
          fill=COLOR_TEXT, font=font_small, anchor="mm")

# Flèche
arrow_x1 = x_left + box1_w//2
arrow_y1 = box1_y + box1_h//2
arrow_x2 = x_right - box1_w//2
arrow_y2 = box1_y + box1_h//2
draw.line([(arrow_x1, arrow_y1), (arrow_x2, arrow_y2)], fill=COLOR_ARROW, width=3)
# Pointe de flèche
draw.polygon([(arrow_x2, arrow_y2), (arrow_x2 - 15, arrow_y2 - 8), (arrow_x2 - 15, arrow_y2 + 8)],
             fill=COLOR_ARROW)

# Box: Optimistic Sponsor
box2_y = box1_y
draw.rounded_rectangle([x_right - box1_w//2, box2_y, x_right + box1_w//2, box2_y + box1_h],
                       radius=10, fill=COLOR_OPTIMISTIC, outline=COLOR_TEXT, width=2)
draw.text((x_right, box2_y + 20), "Optimistic Sponsor (S)", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((x_right, box2_y + 50), "Déploie le contrat", 
          fill=(255, 255, 255), font=font_small, anchor="mm")

# Info box
info_y = box1_y + box1_h + 20
info_w = 400
info_h = 60
draw.rounded_rectangle([WIDTH//2 - info_w//2, info_y, WIDTH//2 + info_w//2, info_y + info_h],
                       radius=10, fill=(230, 247, 255), outline=COLOR_OPTIMISTIC, width=2)
draw.text((WIDTH//2, info_y + 15), "Dépôt: ~0.0706 ETH", 
          fill=COLOR_TEXT, font=font_text, anchor="mm")
draw.text((WIDTH//2, info_y + 40), "Couvre: déploiement + opérations optimistes", 
          fill=COLOR_TEXT, font=font_small, anchor="mm")

# ========== PHASE 2: EXÉCUTION NORMALE ==========
y2 = info_y + info_h + 40

# Box: Contrat sponsorisé
box3_y = y2
draw.rounded_rectangle([WIDTH//2 - box1_w//2, box3_y, WIDTH//2 + box1_w//2, box3_y + box1_h],
                       radius=10, fill=COLOR_CONTRACT, outline=COLOR_TEXT, width=2)
draw.text((WIDTH//2, box3_y + 20), "Contrat Optimistic", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((WIDTH//2, box3_y + 50), "En cours d'exécution", 
          fill=(255, 255, 255), font=font_small, anchor="mm")

# Flèche vers le bas (vers dispute ou completion)
arrow_down_y1 = box3_y + box1_h
arrow_down_y2 = arrow_down_y1 + 60
draw.line([(WIDTH//2, arrow_down_y1), (WIDTH//2, arrow_down_y2)], fill=COLOR_ARROW, width=3)
draw.polygon([(WIDTH//2, arrow_down_y2), (WIDTH//2 - 8, arrow_down_y2 - 15), (WIDTH//2 + 8, arrow_down_y2 - 15)],
             fill=COLOR_ARROW)

# Branchement: Completion vs Dispute
branch_y = arrow_down_y2
branch_x_left = WIDTH//2 - 200
branch_x_right = WIDTH//2 + 200

# Flèche gauche (Completion)
draw.line([(WIDTH//2, branch_y), (branch_x_left, branch_y + 80)], fill=COLOR_SUCCESS, width=3)
draw.polygon([(branch_x_left, branch_y + 80), (branch_x_left - 8, branch_y + 65), (branch_x_left + 8, branch_y + 65)],
             fill=COLOR_SUCCESS)

# Flèche droite (Dispute)
draw.line([(WIDTH//2, branch_y), (branch_x_right, branch_y + 80)], fill=COLOR_DISPUTE, width=3)
draw.polygon([(branch_x_right, branch_y + 80), (branch_x_right - 8, branch_y + 65), (branch_x_right + 8, branch_y + 65)],
             fill=COLOR_DISPUTE)

# Box: Completion
box_complete_y = branch_y + 100
box_complete_w = 250
draw.rounded_rectangle([branch_x_left - box_complete_w//2, box_complete_y, branch_x_left + box_complete_w//2, box_complete_y + 60],
                       radius=10, fill=COLOR_SUCCESS, outline=COLOR_TEXT, width=2)
draw.text((branch_x_left, box_complete_y + 20), "Transaction", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((branch_x_left, box_complete_y + 45), "Complétée", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")

# Box: Dispute
box_dispute_y = box_complete_y
draw.rounded_rectangle([branch_x_right - box_complete_w//2, box_dispute_y, branch_x_right + box_complete_w//2, box_dispute_y + 60],
                       radius=10, fill=COLOR_DISPUTE, outline=COLOR_TEXT, width=2)
draw.text((branch_x_right, box_dispute_y + 20), "Dispute", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((branch_x_right, box_dispute_y + 45), "Déclenchée", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")

# ========== PHASE 3: SPONSORING DISPUTE ==========
y3 = box_dispute_y + 80

# Titre section dispute
draw.text((WIDTH//2, y3), "Sponsoring en cas de Dispute", 
          fill=COLOR_TEXT, font=font_subtitle, anchor="mm")

# Buyer Dispute Sponsor
y4 = y3 + 50
sponsor_box_w = 280
sponsor_box_h = 100

# Box Buyer Sponsor
draw.rounded_rectangle([x_left - sponsor_box_w//2, y4, x_left + sponsor_box_w//2, y4 + sponsor_box_h],
                       radius=10, fill=COLOR_BUYER_SPONSOR, outline=COLOR_TEXT, width=2)
draw.text((x_left, y4 + 20), "Buyer Dispute Sponsor", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((x_left, y4 + 45), "(SB)", 
          fill=(255, 255, 255), font=font_text, anchor="mm")
draw.text((x_left, y4 + 70), "Dépôt: ~0.2377 ETH", 
          fill=(255, 255, 255), font=font_small, anchor="mm")

# Flèche vers le centre
arrow_center_x = WIDTH//2
arrow_center_y = y4 + sponsor_box_h//2
draw.line([(x_left + sponsor_box_w//2, arrow_center_y), (arrow_center_x - 100, arrow_center_y)],
          fill=COLOR_ARROW, width=3)
draw.polygon([(arrow_center_x - 100, arrow_center_y), (arrow_center_x - 85, arrow_center_y - 8), (arrow_center_x - 85, arrow_center_y + 8)],
             fill=COLOR_ARROW)

# Box Contrat Dispute
dispute_contract_w = 200
dispute_contract_h = 120
draw.rounded_rectangle([arrow_center_x - dispute_contract_w//2, arrow_center_y - dispute_contract_h//2,
                        arrow_center_x + dispute_contract_w//2, arrow_center_y + dispute_contract_h//2],
                       radius=10, fill=(231, 76, 60, 180), outline=COLOR_TEXT, width=2)
draw.text((arrow_center_x, arrow_center_y - 30), "DisputeSOXAccount", 
          fill=(255, 255, 255), font=font_text, anchor="mm")
draw.text((arrow_center_x, arrow_center_y - 5), "Déployé par", 
          fill=(255, 255, 255), font=font_small, anchor="mm")
draw.text((arrow_center_x, arrow_center_y + 20), "Vendor Sponsor", 
          fill=(255, 255, 255), font=font_small, anchor="mm")

# Flèche depuis Vendor Sponsor
draw.line([(arrow_center_x + 100, arrow_center_y), (x_right - sponsor_box_w//2, arrow_center_y)],
          fill=COLOR_ARROW, width=3)
draw.polygon([(arrow_center_x + 100, arrow_center_y), (arrow_center_x + 85, arrow_center_y - 8), (arrow_center_x + 85, arrow_center_y + 8)],
             fill=COLOR_ARROW)

# Box Vendor Sponsor
draw.rounded_rectangle([x_right - sponsor_box_w//2, y4, x_right + sponsor_box_w//2, y4 + sponsor_box_h],
                       radius=10, fill=COLOR_VENDOR_SPONSOR, outline=COLOR_TEXT, width=2)
draw.text((x_right, y4 + 20), "Vendor Dispute Sponsor", 
          fill=(255, 255, 255), font=font_subtitle, anchor="mm")
draw.text((x_right, y4 + 45), "(SV)", 
          fill=(255, 255, 255), font=font_text, anchor="mm")
draw.text((x_right, y4 + 70), "Dépôt: ~0.2377 ETH", 
          fill=(255, 255, 255), font=font_small, anchor="mm")

# Info box dispute
info_dispute_y = y4 + sponsor_box_h + 30
info_dispute_w = 600
info_dispute_h = 80
draw.rounded_rectangle([WIDTH//2 - info_dispute_w//2, info_dispute_y, WIDTH//2 + info_dispute_w//2, info_dispute_y + info_dispute_h],
                       radius=10, fill=(255, 245, 230), outline=COLOR_DISPUTE, width=2)
draw.text((WIDTH//2, info_dispute_y + 15), "Chaque sponsor paie 50% des frais de dispute", 
          fill=COLOR_TEXT, font=font_text, anchor="mm")
draw.text((WIDTH//2, info_dispute_y + 40), "SB paie les frais du buyer | SV paie les frais du vendor + déploie DisputeSOXAccount", 
          fill=COLOR_TEXT, font=font_small, anchor="mm")
draw.text((WIDTH//2, info_dispute_y + 60), "Les sponsors peuvent récupérer les fonds non utilisés après la dispute", 
          fill=COLOR_TEXT, font=font_small, anchor="mm")

# ========== LÉGENDE ==========
legend_y = info_dispute_y + info_dispute_h + 30
legend_x = WIDTH//2
legend_w = 500

draw.rounded_rectangle([legend_x - legend_w//2, legend_y, legend_x + legend_w//2, legend_y + 120],
                       radius=10, fill=(250, 250, 250), outline=COLOR_TEXT, width=2)
draw.text((legend_x, legend_y + 10), "Légende", 
          fill=COLOR_TEXT, font=font_subtitle, anchor="mm")

# Items légende
legend_items = [
    ("S", COLOR_OPTIMISTIC, "Optimistic Sponsor - Déploie le contrat initial"),
    ("SB", COLOR_BUYER_SPONSOR, "Buyer Dispute Sponsor - Paie les frais du buyer"),
    ("SV", COLOR_VENDOR_SPONSOR, "Vendor Dispute Sponsor - Paie les frais du vendor"),
]

for i, (label, color, desc) in enumerate(legend_items):
    y_item = legend_y + 35 + i * 25
    draw.ellipse([legend_x - legend_w//2 + 20, y_item - 8, legend_x - legend_w//2 + 50, y_item + 8],
                fill=color, outline=COLOR_TEXT, width=1)
    draw.text((legend_x - legend_w//2 + 60, y_item), f"{label}: {desc}", 
              fill=COLOR_TEXT, font=font_small, anchor="lm")

# Sauvegarder
output_path = "sponsoring_flow_diagram.png"
img.save(output_path)
print(f"✅ Diagramme créé: {output_path}")






