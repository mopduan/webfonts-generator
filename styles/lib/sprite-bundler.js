const assert = require('assert');
const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const Minimatch = require('minimatch').Minimatch;
const templater = require('spritesheet-templates');
const Spritesmith = require('spritesmith');
const url = require('url2');
const glob = require('glob');
const chalk = require('chalk');

const customizeFile = require('../../../lib/customized/file');

function ExtFormat() {
    this.formatObj = {};
}
ExtFormat.prototype = {
    add: function (name, val) {
        this.formatObj[name] = val;
    },
    get: function (filepath) {
        // Grab the extension from the filepath
        const ext = path.extname(filepath);
        const lowerExt = ext.toLowerCase();

        // Look up the file extenion from our format object
        const formatObj = this.formatObj;
        const format = formatObj[lowerExt];
        return format;
    }
};

// Create img and css formats
const imgFormats = new ExtFormat();
const cssFormats = new ExtFormat();

// Add our img formats
imgFormats.add('.png', 'png');
imgFormats.add('.jpg', 'jpeg');
imgFormats.add('.jpeg', 'jpeg');

// Add our css formats
cssFormats.add('.styl', 'stylus');
cssFormats.add('.stylus', 'stylus');
cssFormats.add('.sass', 'sass');
cssFormats.add('.scss', 'scss');
cssFormats.add('.less', 'less');
cssFormats.add('.json', 'json');
cssFormats.add('.css', 'css');

// Copy/paste helper from gulp
// https://github.com/wearefractal/glob-stream/blob/v5.0.0/index.js#L131-L138
function unrelative(cwd, glob) {
    let mod = '';
    if (glob[0] === '!') {
        mod = glob[0];
        glob = glob.slice(1);
    }
    return mod + path.resolve(cwd, glob);
}

// Define helper for coordinate naming
function getCoordinateName(filepath) {
    // Extract the image name (exlcuding extension)
    const fullname = path.basename(filepath);
    const nameParts = fullname.split('.');

    // If there is are more than 2 parts, pop the last one
    if (nameParts.length >= 2) {
        nameParts.pop();
    }

    // Return our modified filename
    return nameParts.join('.');
}

// Create a gulp-spritesmith function
async function spriteBundler(params) {
    const imgSrc = params.imgSrc; // 图片来源路径，glob格式
    const imgName = params.imgName;
    const cssName = params.cssName;
    const dest = params.dest || '.';
    const dev = params.dev;
    assert(imgSrc, `No 'imgSrc' found!`);
    assert(imgName, 'An `imgName` parameter was not provided to `gulp.spritesmith` (required)');
    assert(cssName, 'A `cssName` parameter was not provided to `gulp.spritesmith` (required)');

    // If there are settings for retina, verify our all of them are present
    const retinaSrcFilter = params.retinaSrcFilter;
    const retinaImgName = params.retinaImgName;
    if (retinaSrcFilter || retinaImgName) {
        assert(retinaSrcFilter && retinaImgName, 'Retina settings detected. We must have both `retinaSrcFilter` and ' +
            '`retinaImgName` provided for retina to work');
    }

    // 读取所有的图片文件地址
    let images = glob.sync(imgSrc);

    if (Array.isArray(images) && images.length) {
        // Determine the format of the image
        let imgOpts = params.imgOpts || {};
        const imgFormat = imgOpts.format || imgFormats.get(imgName) || 'png';

        // Set up the defautls for imgOpts
        imgOpts = _.defaults({}, imgOpts, { format: imgFormat });

        // If we have retina settings, filter out the retina images
        let retinaImages;

        if (retinaSrcFilter) {
            // Filter out our retina files
            // https://github.com/wearefractal/glob-stream/blob/v5.0.0/index.js#L84-L87
            retinaImages = [];
            const retinaSrcPatterns = Array.isArray(retinaSrcFilter) ? retinaSrcFilter : [retinaSrcFilter];
            images = images.filter(function filterSrcFile(file) {
                // If we have a retina file, filter it out
                const matched = retinaSrcPatterns.some(function matchMinimatches(retinaSrcPattern) {
                    const minimatch = new Minimatch(unrelative(file.cwd, retinaSrcPattern));
                    return minimatch.match(file);
                });
                if (matched) {
                    retinaImages.push(file);
                    return false;
                    // Otherwise, keep it in the src files
                } else {
                    return true;
                }
            });

            // 2倍图与1倍图数量不对应一致，抛出异常
            if (images.length !== retinaImages.length) {
                const err = new Error('Retina settings detected but ' + retinaImages.length + ' retina images were found. ' +
                    'We have ' + images.length + ' normal images and expect these numbers to line up. ' +
                    'Please double check `retinaSrcFilter`.');
                err.images = images;
                err.retinaImages = retinaImages;

                throw err;
            }
        }

        // Prepare spritesmith parameters
        const spritesmithParams = {
            engine: params.engine,
            algorithm: params.algorithm,
            padding: params.padding || 2,
            algorithmOpts: params.algorithmOpts || {},
            engineOpts: params.engineOpts || {},
            exportOpts: imgOpts
        };

        const bundler = async function () {
            // Construct our spritesmiths
            const spritesmith = new Spritesmith(spritesmithParams);
            var retinaSpritesmithParams; // eslint-disable-line
            var retinaSpritesmith; // eslint-disable-line
            if (retinaImages) {
                retinaSpritesmithParams = _.defaults({
                    padding: spritesmithParams.padding * 2
                }, spritesmithParams);
                retinaSpritesmith = new Spritesmith(retinaSpritesmithParams);
            }

            const generateNormalImages = new Promise((resolve, reject) => {
                spritesmith.createImages(images, (error, _images) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(_images);
                    }
                });
            });

            const generateRetinaSpritesheet = new Promise((resolve, reject) => {
                if (retinaImages) {
                    retinaSpritesmith.createImages(retinaImages, (error, _retinaImages) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(_retinaImages);
                        }
                    });
                } else {
                    resolve(null);
                }
            });

            // 格式：[ [], [] ]
            const _sprites = await Promise.all([generateNormalImages, generateRetinaSpritesheet]);

            // Otherwise, validate our images line up
            const normalSprites = _sprites[0];
            const retinaSprites = _sprites[1];

            if (retinaSprites) {
                // 2倍图与1倍图校验
                let errorEncountered = false;
                normalSprites.forEach(function validateImageSizes(normalSprite, i) {
                    const retinaSprite = retinaSprites[i];
                    // 2倍图宽高必须是1倍图的2倍。
                    if (retinaSprite.width !== normalSprite.width * 2 || retinaSprite.height !== normalSprite.height * 2) {
                        errorEncountered = true;
                        const err = new Error('Normal sprite has inconsistent size with retina sprite. ' +
                            '"' + images[i].path + '" is ' + normalSprite.width + 'x' + normalSprite.height + ' while ' +
                            '"' + retinaImages[i].path + '" is ' + retinaSprite.width + 'x' + retinaSprite.height + '.');
                        err.normalSprite = normalSprite;
                        err.retinaSprite = retinaSprite;

                        throw err;
                    }
                });
            }

            // Process our images now
            const result = spritesmith.processImages(normalSprites, spritesmithParams);
            let retinaResult;
            if (retinaSprites) {
                retinaResult = retinaSpritesmith.processImages(retinaSprites, retinaSpritesmithParams);
            }

            // START OF DUPLICATE CODE FROM grunt-spritesmith
            // Generate a listing of CSS variables
            const coordinates = result.coordinates;
            const properties = result.properties;
            const spritePath = params.imgPath || url.relative(cssName, imgName);

            const spritesheetData = {
                width: properties.width,
                height: properties.height,
                image: spritePath
            };
            const cssVarMap = params.cssVarMap || function noop() {
            };
            const cleanCoords = [];

            // Clean up the file name of the file
            Object.getOwnPropertyNames(coordinates).sort().forEach(function (file) {
                // Extract out our name
                const name = getCoordinateName(file);
                let coords = coordinates[file];

                // Specify the image for the sprite
                coords.name = name;
                coords.source_image = file;
                // DEV: `image`, `total_width`, `total_height` are deprecated as they are overwritten in `spritesheet-templates`
                coords.image = spritePath;
                coords.total_width = properties.width;
                coords.total_height = properties.height;

                // Map the coordinates through cssVarMap
                coords = cssVarMap(coords) || coords;

                // Save the cleaned name and coordinates
                cleanCoords.push(coords);
            });

            // If we have retina sprites
            var retinaCleanCoords; // eslint-disable-line
            var retinaGroups; // eslint-disable-line
            var retinaSpritesheetInfo; // eslint-disable-line
            if (retinaResult) {
                // Generate a listing of CSS variables
                const retinaCoordinates = retinaResult.coordinates;
                const retinaProperties = retinaResult.properties;
                const retinaSpritePath = params.retinaImgPath || url.relative(cssName, retinaImgName);
                retinaSpritesheetInfo = {
                    width: retinaProperties.width,
                    height: retinaProperties.height,
                    image: retinaSpritePath
                };
                // DEV: We reuse cssVarMap
                retinaCleanCoords = [];

                // Clean up the file name of the file
                Object.getOwnPropertyNames(retinaCoordinates).sort().forEach(function prepareRetinaTemplateData(file) {
                    const name = getCoordinateName(file);
                    let coords = retinaCoordinates[file];
                    coords.name = name;
                    coords.source_image = file;
                    coords.image = retinaSpritePath;
                    coords.total_width = retinaProperties.width;
                    coords.total_height = retinaProperties.height;
                    coords = cssVarMap(coords) || coords;
                    retinaCleanCoords.push(coords);
                });

                // Verify we have no conflicting file names (e.g. `1x/home.png` and `2x/home.png`)
                //   https://github.com/twolfson/gulp.spritesmith/issues/124
                const cleanCoordNames = _.pluck(cleanCoords, 'name');
                const retinaCleanCoordNames = _.pluck(retinaCleanCoords, 'name');
                const intersectingNames = _.intersection(cleanCoordNames, retinaCleanCoordNames);
                if (intersectingNames.length) {
                    throw new Error('Normal and retina sprites have same names: ' + JSON.stringify(intersectingNames) + '. ' +
                        'Please rename them to different names (e.g. `-1x`, `-2x`) or use `cssVarMap` to prevent collisions. ' +
                        'See https://github.com/twolfson/gulp.spritesmith/issues/124 for more info');
                }

                // Generate groups for our coordinates
                retinaGroups = cleanCoords.map(function getRetinaGroups(normalSprite, i) {
                    // Generate our group
                    // DEV: Name is inherited from `cssVarMap` on normal sprite
                    return {
                        name: normalSprite.name,
                        index: i
                    };
                });
            }

            // If we have handlebars helpers, register them
            const handlebarsHelpers = params.cssHandlebarsHelpers;
            if (handlebarsHelpers) {
                Object.keys(handlebarsHelpers).forEach(function registerHelper(helperKey) {
                    templater.registerHandlebarsHelper(helperKey, handlebarsHelpers[helperKey]);
                });
            }

            // If there is a custom template, use it
            let cssFormat = 'spritesmith-custom';
            const cssTemplate = params.cssTemplate;
            if (cssTemplate) {
                if (typeof cssTemplate === 'function') {
                    templater.addTemplate(cssFormat, cssTemplate);
                } else {
                    templater.addHandlebarsTemplate(cssFormat, fs.readFileSync(cssTemplate, 'utf8'));
                }
                // Otherwise, override the cssFormat and fallback to 'json'
            } else {
                cssFormat = params.cssFormat;
                if (!cssFormat) {
                    cssFormat = cssFormats.get(cssName) || 'json';

                    // If we are dealing with retina items, move to retina flavor (e.g. `scss` -> `scss_retina`)
                    if (retinaGroups) {
                        cssFormat += '_retina';
                    }
                }
            }

            // Render the variables via `spritesheet-templates`
            const cssStr = templater({
                sprites: cleanCoords,
                spritesheet: spritesheetData,
                spritesheet_info: {
                    name: params.cssSpritesheetName
                },
                retina_groups: retinaGroups,
                retina_sprites: retinaCleanCoords,
                retina_spritesheet: retinaSpritesheetInfo,
                retina_spritesheet_info: {
                    name: params.cssRetinaSpritesheetName
                },
                retina_groups_info: {
                    name: params.cssRetinaGroupsName
                }
            }, {
                    format: cssFormat,
                    formatOpts: params.cssOpts || {}
                });
            // END OF DUPLICATE CODE FROM grunt-spritesmith

            // Pipe out images as streams and forward their errors
            // TODO: Consider making joint stream default
            //   but allow for split stream which has more distinct errors
            //   e.g. spritesmith.split() = {css, img}
            const _outputStreamPromises = [];

            _outputStreamPromises.push(new Promise((resolve, reject) => {
                const _path = path.join(dest, imgName);
                customizeFile.mkdirRecursive(path.dirname(_path));
                // 输出文件路径
                const _writableStream = fs.createWriteStream(_path);
                result.image.pipe(_writableStream);

                result.image.on('end', function () {
                    resolve();
                });

                result.image.on('error', function forwardImgError(err) {
                    reject(err);
                });
            }));

            if (retinaResult) {
                _outputStreamPromises.push(new Promise((resolve, reject) => {
                    const _writableStream = fs.createWriteStream(path.join(dest, retinaImgName));

                    retinaResult.image.pipe(_writableStream);

                    retinaResult.image.on('end', resolve);

                    retinaResult.image.on('error', reject);
                }));
            }

            // _outputStreamPromises.push(new Promise((resolve, reject) => {
            //     // Output the CSS
            //     customizeFile.mkdirRecursive(path.dirname(path.join(dest, cssName)));

            //     const _cssOutputStream = fs.createWriteStream(path.join(dest, cssName));

            //     _cssOutputStream.write(Buffer.from(cssStr));

            //     _cssOutputStream.end();

            //     _cssOutputStream.on('finish', resolve);

            //     _cssOutputStream.on('error', reject);
            // }));

            // await Promise.all(_outputStreamPromises);
        };

        // do bundle
        try {
            await bundler();
        } catch (error) {
            console.log(chalk.bold.red(error));

            process.exit(1);
        }
    }
}

module.exports = spriteBundler;