// Photoshop Script: Save All Open Documents as PNG to this script's folder
// File > Scripts > Browse... > select this file

var scriptFile = new File($.fileName);
var outputFolder = scriptFile.parent;

var pngOptions = new PNGSaveOptions();
pngOptions.compression = 6;
pngOptions.interlaced = false;

var docCount = app.documents.length;
for (var i = 0; i < docCount; i++) {
    app.activeDocument = app.documents[i];
    var doc = app.activeDocument;
    var name = 'bones-' + (i + 1);
    var file = new File(outputFolder + '/' + name + '.png');
    doc.saveAs(file, pngOptions, true, Extension.LOWERCASE);
}
alert('Saved ' + docCount + ' file(s) as PNG to:\n' + outputFolder.fsName);
