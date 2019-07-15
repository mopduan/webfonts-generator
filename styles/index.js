const path = require('path');
const fs = require('fs');

const del = require('del');
const glob = require('glob');
const retinaResizer = require('./lib/retina-resizer');
const spriteBundler = require('./lib/sprite-bundler');
const imgMin = require('./lib/images-min');
const iconFont = require('./lib/iconfont');
const sprite2scss = require('./lib/sprites2scss');
const scssCompile = require('./lib/sass-compile');
const chokidar = require('chokidar');
const chalk = require('chalk');
const _ = require('lodash');

const file = require("../../lib/customized/file");
const customizeUtils = require('../../lib/customized/utils');

const stylesCleaner = function (dir) {
    const deployDir = customizeUtils.normalizePath(dir).replace(global.srcPrefix, global.deployPrefix);
    const _spriteDistPath = path.join(deployDir, 'images/sprite/**');
    const _scssDistPath = path.join(deployDir, '/css/sprite/**');

    del.sync([_spriteDistPath, _scssDistPath], { force: true });
};

/**
 * 打包雪碧图，并生成scss文件 , 压缩图片
 * 需要打包2倍图，请确保目录下文件后缀都以`@2x`结尾
 * 生成的.scss文件会将公用方法(清除浮动等)打包进去
 * @param {*} dir
 * @param {*} config
 */
exports.stylesCompiler = async function (dir, uedDir, config) {
    const _staticDirPath = path.join(dir, uedDir);
    const stylesOption = config.stylesOption;
    const isRetina = stylesOption && stylesOption.retina;
    const divideBy2 = stylesOption && stylesOption.divideBy2;
    const isRem = stylesOption && stylesOption.rem;

    if (global.prebuild) {
        // clean
        stylesCleaner(_staticDirPath);
        // 生成iconfont
        await iconFont(_staticDirPath);
    }

    // 压缩图片
    await imgMin(_staticDirPath);

    const cssTemplate = sprite2scss({
        rem: isRem,
        retina: isRetina,
        divideBy2
    });

    /**
     * 打包雪碧图
     * @param {null|string} filePath
     * @returns {Promise<void>}
     */
    const spritesBuilder = async function () {
        const _spritePath = path.join(dir, `${uedDir}/asset/sprite`);
        const _spriteDist = customizeUtils.normalizePath(_staticDirPath).replace(global.srcPrefix, global.deployPrefix);

        // 默认全量图片文件全部打包
        const globPath = `${dir.replace(/\/$/, '')}/${uedDir}/asset/sprite/**/*.{png,jpg,gif}`;


        // TODO 测试2倍图中不包含`@2x`的情况
        if (isRetina) {
            console.log('retina resizer start');
            await retinaResizer(globPath, 2);
            console.log('retina resizer done');
        }

        const _spriteBundlePromises = []; // 雪碧图打包以及生成scss列表


        const _spriteDirs = fs.readdirSync(_spritePath);

        _spriteDirs.forEach(_dir => {
            _dir = customizeUtils.normalizePath(_dir);
            const _path = customizeUtils.normalizePath(path.join(_spritePath, _dir));
            const _stats = fs.statSync(_path);

            if (_stats.isDirectory()) {
                const _spriteDistPath = _path.replace(global.srcPrefix, global.deployPrefix).replace('/asset', '/images');
                file.mkdirRecursive(_spriteDistPath);

                let _imgSrc = `${_path}/**/*.{png,jpg,gif}`;

                let _spritesmithConfig = {
                    imgSrc: _imgSrc,
                    imgName: `images/sprite/${_dir}/sprite_${_dir}.png`,
                    cssName: `css/sprite/sprite_${_dir}.scss`,
                    imgPath: `/${uedDir}/images/sprite/${_dir}/sprite_${_dir}.png`,
                    cssTemplate: cssTemplate,
                    dest: _spriteDist
                };

                if (isRetina) {
                    const retinaTmpDir = _spriteDistPath.replace('/sprite', '/sprite/.retina_tmp');
                    _imgSrc = `${retinaTmpDir}/**/*.{png,jpg,gif}`;

                    _spritesmithConfig = {
                        padding: 8,
                        imgSrc: _imgSrc,
                        imgName: `images/sprite/${_dir}/sprite_${_dir}@1x.png`,
                        imgPath: `/${uedDir}/images/sprite/${_dir}/sprite_${_dir}@1x.png`,
                        cssName: `css/sprite/sprite_${_dir}.scss`,
                        retinaImgName: `images/sprite/${_dir}/sprite_${_dir}@2x.png`,
                        retinaSrcFilter: `${retinaTmpDir}/**/*@2x.{png,jpg,gif}`,
                        retinaImgPath: `/${uedDir}/images/sprite/${_dir}/sprite_${_dir}@2x.png`,
                        cssTemplate: cssTemplate,
                        dest: _spriteDist
                    };
                }

                _spriteBundlePromises.push(new Promise(async (resolve, reject) => {
                    try {
                        await spriteBundler(_spritesmithConfig);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }));
            }
        });

        let _spriteBundlePath = `${_spritePath}/*.{png,jpg,gif}`;
        const retinaTmpDir = customizeUtils.normalizePath(_spritePath).replace(global.srcPrefix, global.deployPrefix).replace('/asset', '/images').replace('/sprite', '/sprite/.retina_tmp');

        let _spritesmithConfig = {
            imgSrc: _spriteBundlePath,
            imgName: 'images/sprite/sprite.png',
            cssName: 'css/sprite/sprite.scss',
            imgPath: `/${uedDir}/images/sprite/sprite.png`,
            cssTemplate: cssTemplate,
            dest: _spriteDist
        };

        if (isRetina) {
            _spriteBundlePath = `${retinaTmpDir}/*.{png,jpg,gif}`;

            _spritesmithConfig = {
                padding: 8,
                imgSrc: _spriteBundlePath,
                imgName: 'images/sprite/sprite@1x.png',
                cssName: 'css/sprite/sprite.scss',
                imgPath: `/${uedDir}/images/sprite/sprite@1x.png`,
                retinaImgName: `images/sprite/sprite@2x.png`,
                retinaSrcFilter: `${retinaTmpDir}/*@2x.{png,jpg,gif}`,
                retinaImgPath: `/${uedDir}/images/sprite/sprite@2x.png`,
                cssTemplate: cssTemplate,
                dest: _spriteDist
            };
        }

        _spriteBundlePromises.push(new Promise(async (resolve, reject) => {
            try {
                await spriteBundler(_spritesmithConfig);
                resolve();
            } catch (e) {
                reject(e);
            }
        }));

        await Promise.all(_spriteBundlePromises);
    };

    const spriteDir = path.join(customizeUtils.normalizePath(_staticDirPath), 'asset/sprite');

    if (fs.existsSync(spriteDir) && fs.readdirSync(spriteDir).length && global.prebuild)
        await spritesBuilder();

    global.sassCompileList = global.cssCompileList;

    if (global.sassCompileList && global.sassCompileList.length)
        await scssCompile(dir, uedDir, config);

    const _cssDir = customizeUtils.normalizePath(path.join(_staticDirPath, 'css'));

    console.log(chalk.blue(`SASS compilation: Watching for changes in ${uedDir}/css/**/*.scss`));

    // 监听sass文件变化
    chokidar.watch(`${_cssDir}/**/*.scss`).on('all', _.debounce(async (event, path) => {
        if (event === 'change' || event === 'unlink') {
            try {
                require('system-sleep')(1000);
                await scssCompile(dir, uedDir, config);
                console.log(path, 'rebuild success!');

                if (global.socket) {
                    global.socket.emit("refresh", { "refresh": 1 });
                    console.log("scss files changed： trigger refresh...");
                }
            } catch (error) {
                console.log(chalk.bold.red(error.message));
            }
        }
    }));
};