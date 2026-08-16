/* ============================================================
   Unseelie Workshop — Grain Texture
   Generates a static noise texture once via canvas and applies
   it as a CSS custom property, avoiding live SVG filter cost.
   ============================================================ */

(function () {
    var canvas = document.createElement('canvas');
    var size   = 200;
    canvas.width  = size;
    canvas.height = size;

    var ctx       = canvas.getContext('2d');
    var imageData = ctx.createImageData(size, size);
    var data      = imageData.data;

    for (var i = 0; i < data.length; i += 4) {
        var v = Math.floor(Math.random() * 255);
        data[i]     = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 18;
    }

    ctx.putImageData(imageData, 0, 0);
    document.documentElement.style.setProperty('--grain-url', 'url(' + canvas.toDataURL() + ')');
}());
