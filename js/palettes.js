// Provides palettes
// When run as main, writes palette order to stdout && values to palettes.json
// Adds a final 'repeating' PairedRepeat singleton palette

var _      = require('underscore');
var brewer = require('colorbrewer');


//////////// SORT PALETTES

//fixed ~alphabetic order
var palettes = ["Paired", "Blues", "BrBG", "BuGn", "BuPu", "Dark2", "GnBu", "Greens", "Greys", "OrRd", "Oranges", "PRGn", "Accent", "Pastel1", "Pastel2", "PiYG", "PuBu", "PuBuGn", "PuOr", "PuRd", "Purples", "RdBu", "RdGy", "RdPu", "RdYlBu", "RdYlGn", "Reds", "Set1", "Set2", "Set3", "Spectral", "YlGn", "YlGnBu", "YlOrBr", "YlOrRd", "PairedRepeat"];

//how it was generated
if (require.main === module) {

    palettes = Object.keys(brewer);
    palettes.sort();

    //for historical reasons, put 'Paired' first
    var oldPos = palettes.indexOf('Paired');
    var tmp = palettes[0];
    palettes[0] = palettes[oldPos];
    palettes[oldPos] = tmp;

    palettes.push('PairedRepeat')

    console.log('["' + palettes.join('", "') + '"]')
}

//redone for printing below
brewer['PairedRepeat'] = {
    0: _.flatten(_.times(10000, function () { return brewer['Paired'][12]; }))
};

////////////// BIND PALETTES

//'#AABBCC' -> int
//TODO: this returns ABGR as that's what vgraphloader sends to the client
function hexToInt (hexStr) {
    var out = parseInt(hexStr.replace('#', '0x'), 16);

    //sadness, rgba => abgr
    var c = {
        r: (out >> 16) & 255,
        g: (out >> 8) & 255,
        b: out & 255
    };

    return (c.b << 16) | (c.g << 8) | c.r;
}

//{<string> -> {<int> -> [int]_int}}
var palettesToColorInts = {};

//{int -> int}
var categoryToColorInt = {};

//{<string> -> {<int> -> {hexes: [string], offset: int}}}
var all = {};

var encounteredPalettes = 0;
palettes.forEach(function (palette) {
    palettesToColorInts[palette] = {};
    all[palette] = {};

    var dims = Object.keys(brewer[palette]);

    //for legacy/convenience, biggest first
    dims.sort(function (a, b) { return a - b; });
    dims.reverse();

    dims.forEach(function (dim) {

        //use to create palette.out
        //console.log('palette', palette, encounteredPalettes * 1000, brewer[palette][dim].length, brewer[palette][dim].join(','))

        palettesToColorInts[palette][dim] = brewer[palette][dim].map(hexToInt);
        palettesToColorInts[palette][dim].forEach(function (color, idx) {
            categoryToColorInt[encounteredPalettes * 1000 + idx] = color;
        });

        all[palette][dim] = {
            offset: encounteredPalettes * 1000,
            hexes: brewer[palette][dim]
        };

        encounteredPalettes++;
    });
});


//use to create palette.json
if (require.main === module) {
    var fs = require('fs');

    var modifiedDocs = JSON.parse(JSON.stringify(all));
    delete modifiedDocs['PairedRepeat'];
    modifiedDocs['PairedRepeat (repeats 10,000 times)'] = {
        12: {
            offset: 265000,
            hexes: all['Paired'][12].hexes
        }
    };

    fs.writeFile('palette.js', 'palettes = ' + JSON.stringify(modifiedDocs), function (err) {
        if (err) {
            console.error('bad write of palette.js', err);
        } else {
            console.log('wrote palette.js');
        }
    });
}


//////////////

module.exports = {

    //{<string> -> {<int> -> [int]_int}}
    //Ex:  palettes['Paired']['12'][3] == 3383340
    palettes: palettesToColorInts,

    //{int -> int}
    //Ex: bindings[9 * 1000 + 3] == 3383340
    bindings: categoryToColorInt

};