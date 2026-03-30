// Photoshop Script: Save All Open Documents as PNG
// Drop this into the the-familiar folder, then run from Photoshop:
// File > Scripts > Browse... > select this file

var outputFolder = Folder.selectDialog("Choose output folder for PNGs");
if (outputFolder) {
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;

    var docCount = app.documents.length;
    for (var i = docCount - 1; i >= 0; i--) {
        app.activeDocument = app.documents[i];
        var doc = app.activeDocument;
        var name = doc.name.replace(/\.[^\.]+$/, ''); // strip extension
        var file = new File(outputFolder + '/' + name + '.png');
        doc.saveAs(file, pngOptions, true, Extension.LOWERCASE);
    }
    alert('Saved ' + docCount + ' file(s) as PNG to:\n' + outputFolder.fsName);
}
