// CommonJS 版本的测试脚本
const fs = require('fs');
const path = require('path');

console.log('=== Gemini Adapter Analysis ===\n');

// 读取和分析 Gemini 适配器代码
const adapterPath = path.join(__dirname, 'src/content/adapters/gemini.ts');
const selectorsPath = path.join(__dirname, 'src/content/selectors.ts');

function analyzeGeminiAdapter() {
  console.log('1. 分析 Gemini 适配器实现...\n');
  
  try {
    const adapterCode = fs.readFileSync(adapterPath, 'utf8');
    const selectorsCode = fs.readFileSync(selectorsPath, 'utf8');
    
    // 分析适配器类
    console.log('GeminiAdapter 类统计:');
    const classMatch = adapterCode.match(/class GeminiAdapter extends BaseAdapter\s*\{([\s\S]*?)^\}/m);
    if (classMatch) {
      const classContent = classMatch[1];
      const methods = classContent.match(/(?:^\s*\w+\s+\w+\([^)]*\)[^{]*\{|async\s+\w+\([^)]*\)[^{]*\{)/gm) || [];
      console.log(`  方法数量: ${methods.length}`);
      methods.forEach(method => {
        const nameMatch = method.match(/(?:async\s+)?(\w+)\s*\(/);
        if (nameMatch) console.log(`  - ${nameMatch[1]}`);
      });
    }
    
    console.log('\n2. 分析选择器配置...\n');
    
    // 提取 Gemini 选择器
    const geminiSelectorsMatch = selectorsCode.match(/export const GEMINI_SELECTORS: PlatformSelectors = \{([\s\S]*?)\};/);
    if (geminiSelectorsMatch) {
      const selectorContent = geminiSelectorsMatch[1];
      
      // 统计各类选择器
      const assistantSelectors = selectorContent.match(/assistantMessage:\s*\[([\s\S]*?)\]/);
      const userSelectors = selectorContent.match(/userMessage:\s*\[([\s\S]*?)\]/);
      const copySelectors = selectorContent.match(/copyButton:\s*\[([\s\S]*?)\]/);
      const excludeSelectors = selectorContent.match(/excludeSelectors:\s*\[([\s\S]*?)\]/);
      
      if (assistantSelectors) {
        const selectors = assistantSelectors[1].split('\n').filter(s => s.trim() && !s.includes('//'));
        console.log(`助手消息选择器 (${selectors.length}个):`);
        selectors.forEach(s => console.log(`  ${s.trim()}`));
      }
      
      console.log('');
      if (userSelectors) {
        const selectors = userSelectors[1].split('\n').filter(s => s.trim() && !s.includes('//'));
        console.log(`用户消息选择器 (${selectors.length}个):`);
        selectors.forEach(s => console.log(`  ${s.trim()}`));
      }
      
      console.log('');
      if (copySelectors) {
        const selectors = copySelectors[1].split('\n').filter(s => s.trim() && !s.includes('//'));
        console.log(`复制按钮选择器 (${selectors.length}个):`);
        selectors.forEach(s => console.log(`  ${s.trim()}`));
      }
    }
    
    console.log('\n3. 关键实现特性分析...\n');
    
    // 检查特定功能实现
    const checks = [
      { name: 'URL 匹配', pattern: /matches\(url: string\)/, found: adapterCode.includes('matches(url: string)') },
      { name: '助手消息查找', pattern: /findAssistantMessages/, found: adapterCode.includes('findAssistantMessages') },
      { name: '用户消息查找', pattern: /findUserMessage/, found: adapterCode.includes('findUserMessage') },
      { name: '复制按钮查找', pattern: /findCopyButtons/, found: adapterCode.includes('findCopyButtons') },
      { name: '附件提取', pattern: /extractAttachments/, found: adapterCode.includes('extractAttachments') },
      { name: 'Material Design 支持', pattern: /mat-icon|mat-button/, found: adapterCode.includes('mat-icon') || adapterCode.includes('mat-button') },
      { name: '角色属性支持', pattern: /role="[^"]*"/, found: adapterCode.includes('role=') },
    ];
    
    console.log('功能实现状态:');
    checks.forEach(check => {
      console.log(`  ${check.found ? '✓' : '✗'} ${check.name}`);
    });
    
    console.log('\n4. 测试用例覆盖分析...\n');
    
    const testPath = path.join(__dirname, 'tests/gemini-integration.test.ts');
    if (fs.existsSync(testPath)) {
      const testCode = fs.readFileSync(testPath, 'utf8');
      const testCount = (testCode.match(/test\(/g) || []).length;
      const describeCount = (testCode.match(/describe\(/g) || []).length;
      
      console.log(`测试文件包含:`);
      console.log(`  ${describeCount} 个测试套件`);
      console.log(`  ${testCount} 个测试用例`);
      
      // 提取测试主题
      const testTitles = testCode.match(/test\(['"`]([^'`"]+)['"`]/g) || [];
      console.log(`\n测试主题:`);
      testTitles.slice(0, 10).forEach(title => {
        const cleanTitle = title.replace(/test\(['"`]/, '').replace(/['"`]/, '');
        console.log(`  - ${cleanTitle}`);
      });
      if (testTitles.length > 10) {
        console.log(`  ... 还有 ${testTitles.length - 10} 个测试`);
      }
    } else {
      console.log('测试文件不存在，建议创建 tests/gemini-integration.test.ts');
    }
    
    console.log('\n5. 下一步建议...\n');
    console.log('1. 在真实 Gemini 页面验证选择器有效性');
    console.log('2. 测试 Material Design 组件的适配情况');
    console.log('3. 验证附件提取逻辑（图片、文件、代码块）');
    console.log('4. 测试复杂对话结构的消息关联');
    console.log('5. 创建浏览器自动化测试进行完整验证');
    
  } catch (error) {
    console.error('分析失败:', error.message);
  }
}

analyzeGeminiAdapter();

console.log('\n=== 分析完成 ===');
console.log('\n总结：');
console.log('Gemini 适配器已实现基本框架，需要：');
console.log('- 真实环境验证选择器');
console.log('- 补充边缘情况处理');
console.log('- 集成到 content-script 进行端到端测试');