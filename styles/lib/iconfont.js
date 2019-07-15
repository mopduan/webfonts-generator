const fs = require('fs');
const path = require('path');
const webfontsGenerator = require('@shequfe/webfonts-generator');
const utils = require('../../../lib/utils');

exports = module.exports = async function (dir) {
    const fontDir = path.join(dir, 'asset/iconfont');
    const fontCSSDest = path.join(fontDir, 'iconfont.css');
    const fontSCSSDest = path.join(dir, 'css/common/_iconfont.scss');
    const fontCodeReg = /\.icon-(\w+):before\s*{\s*content\s*:\s*"\\(\w+)/g;
    let fileList = []; // 已生成的svg文件列表，按生成顺序排列，即生成ttf中码点的顺序
    const iconFontConfig = path.join(dir, 'css/common/iconfont.cfg');

    const generateFonts = () => {
        try {
            fileList = fs.readFileSync(iconFontConfig, { encoding: 'utf-8' }).split('\n');
            fileList = fileList.map(item => utils.normalizePath(path.join(dir, item)));
        } catch (e) { }

        const allFiles = utils.getAllFilesByDir(fontDir, ['.svg']);
        const newFileList = allFiles.filter(item => !fileList.includes(item));
        const generateFileList = fileList.concat(newFileList).filter(item => allFiles.includes(item));

        console.log('newFileList:', newFileList);

        return new Promise((reslove, reject) => {
            webfontsGenerator({
                files: generateFileList,
                dest: utils.normalizePath(fontDir).replace(global.srcPrefix, global.deployPrefix).replace('asset/iconfont', 'font'),
                css: true,
                cssDest: fontCSSDest,
                formatOptions: {
                    svg: {
                        normalize: true,
                        fontHeight: 1001
                    }
                }
            }, function (error) {
                if (error) {
                    console.log('iconfont generator fail!', error);
                    reject(error);
                } else {
                    console.log('iconfont generator done!');

                    if (fs.existsSync(fontCSSDest)) {
                        // 生成对应icons对象
                        const ICON_DATA_STR = '$__iconfont__data';
                        const ICON_FONT_FUNC = path.join(__dirname, './common-scss/_iconfont.scss');
                        const icons = {};
                        fs.readFileSync(fontCSSDest, { encoding: 'utf-8' }).replace(fontCodeReg, (match, $1, $2) => {
                            icons[$1] = `\\${$2}`;
                        });

                        const fileNameList = generateFileList.map(item => utils.normalizePath(item).replace(utils.normalizePath(dir), '')).join('\n');
                        const content = [
                            `${ICON_DATA_STR}: ` + JSON.stringify(icons, null, '\t').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\\\\/g, '\\') + ';',
                            fs.readFileSync(ICON_FONT_FUNC, { encoding: 'utf-8' }).toString()
                        ].join('\n\n');
                        fs.writeFileSync(fontSCSSDest, content);
                        fs.writeFileSync(iconFontConfig, fileNameList);
                    }

                    reslove();
                }
            });
        });
    };

    if (fs.existsSync(fontDir) && utils.getAllFilesByDir(fontDir, ['.svg']).length)
        await generateFonts();
};