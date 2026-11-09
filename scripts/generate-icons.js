/**
 * 图标生成脚本
 * 
 * 由于项目没有 Node.js 环境，这个脚本用于说明如何生成图标
 * 
 * 方法 1: 使用在线工具
 * - 访问 https://cloudconvert.com/svg-to-png
 * - 上传 public/icons/icon.svg
 * - 分别生成 16x16, 32x32, 48x48, 128x128 尺寸的 PNG
 * 
 * 方法 2: 使用 ImageMagick (如果已安装)
 * - convert icon.svg -resize 16x16 icon-16.png
 * - convert icon.svg -resize 32x32 icon-32.png
 * - convert icon.svg -resize 48x48 icon-48.png
 * - convert icon.svg -resize 128x128 icon-128.png
 * 
 * 方法 3: 使用 Sharp (需要 Node.js)
 * - npm install sharp
 * - node scripts/generate-icons.js
 */

// 如果已安装 Node.js 和 sharp，可以使用以下代码
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function generateIcons() {
  const svgPath = path.join(__dirname, '../public/icons/icon.svg');
  const sizes = [16, 32, 48, 128];
  
  for (const size of sizes) {
    const outputPath = path.join(__dirname, `../public/icons/icon-${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }
}

generateIcons().catch(console.error);
