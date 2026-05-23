const { rcedit } = require('rcedit');
const path = require('path');

/**
 * afterPack 钩子：在 signAndEditExecutable=false 时，
 * 用 rcedit npm 包手动写入 exe 图标和元数据
 */
exports.default = async function (context) {
    const appOutDir = context.appOutDir;
    const productFilename = context.packager.appInfo.productFilename;
    const exePath = path.join(appOutDir, `${productFilename}.exe`);

    // 图标路径：统一使用 static/icons/
    const icoPath = path.join(__dirname, '..', 'static', 'icons', 'icon.ico');
    const pngPath = path.join(__dirname, '..', 'static', 'icons', 'icon.png');

    let iconPath;
    try {
        require('fs').accessSync(icoPath);
        iconPath = icoPath;
    } catch {
        iconPath = pngPath;
    }

    const productInfo = context.packager.appInfo;
    const version = productInfo.version;

    console.log(`[after-pack] 正在写入图标: ${iconPath}`);
    console.log(`[after-pack] 目标 exe: ${exePath}`);

    try {
        await rcedit(exePath, {
            'icon': iconPath,
            'file-version': version,
            'product-version': version,
            'version-string': {
                FileDescription: productInfo.productName,
                ProductName: productInfo.productName,
                CompanyName: productInfo.companyName || '',
                LegalCopyright: productInfo.copyright || '',
                OriginalFilename: `${productFilename}.exe`,
            },
        });
        console.log('[after-pack] 图标和元数据写入成功');
    } catch (err) {
        console.warn('[after-pack] 图标写入失败:', err.message);
    }
};
