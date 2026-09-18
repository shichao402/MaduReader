"""
Create application icon from SVG using Python PIL
"""
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(output_path: str):
    """Create a simple blue icon with MD text"""
    
    # Create icon at multiple sizes
    sizes = [16, 32, 48, 64, 128, 256, 512]
    
    images = []
    
    for size in sizes:
        # Create image with transparency
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # Draw rounded rectangle background
        padding = size // 12
        bg_color = (74, 144, 226, 255)  # #4A90E2
        
        # Draw outer rounded rect
        draw.rounded_rectangle(
            [padding, padding, size - padding, size - padding],
            radius=size // 6,
            fill=bg_color
        )
        
        # Draw inner rounded rect
        inner_padding = size // 8
        inner_color = (107, 163, 240, 255)  # #6BA3F0
        draw.rounded_rectangle(
            [inner_padding, inner_padding, size - inner_padding, size - inner_padding],
            radius=size // 12,
            fill=inner_color
        )
        
        # Draw MD text
        try:
            # Try to use a system font
            font_size = size // 3
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
        
        text = "Ma"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Position text in center
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - size // 20
        
        draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
        
        images.append(img)
    
    # Save as ICO with multiple sizes
    if images:
        images[0].save(
            output_path,
            format='ICO',
            sizes=[(s, s) for s in sizes],
            append_images=images[1:]
        )
        print(f"Icon created: {output_path}")
    else:
        print("Failed to create icon")

if __name__ == "__main__":
    output_dir = os.path.join(os.path.dirname(__file__), "src-tauri", "icons")
    os.makedirs(output_dir, exist_ok=True)
    
    create_icon(os.path.join(output_dir, "icon.ico"))
