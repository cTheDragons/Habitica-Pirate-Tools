/*

This code is licensed under the same terms as Habitica:
    https://raw.githubusercontent.com/HabitRPG/habitrpg/develop/LICENSE


Contributors:
    cTheDragons https://github.com/cTheDragons

*/

//////////////////////////////////////////////////////////////////////
////   External Function (Require)                   /////////////////
//////////////////////////////////////////////////////////////////////
var moment = require('moment');
var request = require('request').defaults({jar: true});
var _ = require('lodash');
var fs = require('fs');
const ChartJsImage = require('chartjs-to-image');
const chart = new ChartJsImage(); // Generate the chart


module.exports = {
completeRun: function  (modeEnvironment, jrnName, jrnPWord){

//////////////////////////////////////////////////////////////////////
////   Global Constants                              /////////////////
//////////////////////////////////////////////////////////////////////
const DOUBLEQUOTES = 		'"' //This is to make my life easier... 
const SINGLEQUOTE =       "'"
const ESCAPECHAR =        "\\"

const environment = modeEnvironment || 'production';
const config = require('./config.json');
const defaultConfig = config.production;
const environmentConfig = config[environment];
const gConfig = _.merge(defaultConfig, environmentConfig);

//////////////////////////////////////////////////////////////////////
////   Global External Reports      //////////////////////////////
//////////////////////////////////////////////////////////////////////
//These are stated here as they should never change.
gConfig.journalGus =  gConfig.folderStat +  gConfig.outputFilePrefix + 'gus.json' //GUS Files
gConfig.journalPirate = gConfig.folderStat + gConfig.outputFilePrefix + 'pirate.json' //list of all ships being looked after by the pirates
gConfig.journalContent = gConfig.folderStat +  gConfig.outputFilePrefix + 'content.json' //list of all data

//Output Logs
gConfig.outputLogPrefix = gConfig.folderOutput +  gConfig.outputFilePrefix + 'output'

//////////////////////////////////////////////////////////////////////
////   Global Variables             //////////////////////////////////
//////////////////////////////////////////////////////////////////////
var listGus = {} //master list
var listPirate = {} // Lanaguages for all Hails
var listContent = {}

var listGus_perLanguage = {} //will create array for each langauge. 
listGus_count = {}

var langBotswain = {}
var langClassification = {}
var langGus = {}
var langGus_altSort = {}
var langSocialite = {}

var lastWikiAction = '2000-01-01'

//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   Start here                                    /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//init file
consoleLogInitFile(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS') + '\n')
if (gConfig.debugConsole) console.log(moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS'))

if (gConfig.debug) consoleLogToFile('debug START Botswain complete run');

//Load Lists
var fileContents = fs.readFileSync(gConfig.journalGus, 'utf-8');
var tempBox = JSON.parse(fileContents)
listGus = tempBox

var fileContents = fs.readFileSync(gConfig.journalPirate, 'utf-8');
var tempBox = JSON.parse(fileContents)
listPirate = tempBox


var fileContents = fs.readFileSync(gConfig.journalContent, 'utf-8');
var tempBox = JSON.parse(fileContents)
listContent = tempBox


//Load Language Files
Object.keys(gConfig.langAvail).forEach(function (obj, index){

    var filepath = gConfig.folderLang + obj + '/' + gConfig.fileLang
    var fileContents = fs.readFileSync(filepath, 'utf-8')
    var tempBox = JSON.parse(fileContents)
    langBotswain[obj] = tempBox


    var filepath = gConfig.folderLang + obj + '/' + gConfig.fileLangClassification
    var fileContents = fs.readFileSync(filepath, 'utf-8')
    var tempBox = JSON.parse(fileContents)
    langClassification[obj] = tempBox


    var filepath = gConfig.folderLang + obj + '/' + gConfig.fileLangGus
    var fileContents = fs.readFileSync(filepath, 'utf-8')
    var tempBox = JSON.parse(fileContents)
    langGus[obj] = tempBox


    //Create the altSort while we are here.
    langGus_altSort[obj] = {}
    var tempSortLangGusValue = _.sortBy(Object.values(langGus[obj]))

    tempSortLangGusValue.forEach(function(obj2, index2){
        Object.keys(langGus[obj]).forEach(function(obj3, index3){         
            if (langGus[obj][obj3] == obj2) langGus_altSort[obj][obj3] = _.clone(langGus[obj][obj3])
        });
    });
});

//Sociallite Greetings
gConfig.langSocialite.forEach(function (obj, index){

    var filepath = gConfig.folderLang + obj + '/' + gConfig.fileSocialite
    var fileContents = fs.readFileSync(filepath, 'utf-8')
    var tempBox = JSON.parse(fileContents)
    langSocialite[obj] = tempBox

});    


createCharts()
createJrnGus()
createJrnPirate()
createJrnGusCx()




//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   Create Chart                                  /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function createCharts(){
    if (gConfig.debug) consoleLogToFile('debug createCharts START')

    var labelsArray = []
    var dataArray = []
    var tempTextArray = []
    var count = 0

    var obj = gConfig.langDefault //Assume we only doing for the default languge for the moment

    //////////////////////////////////////////////////////////////////////
    ////   All Ships Status                                /////////////////
    //////////////////////////////////////////////////////////////////////
    labelsArray = [langClassification[obj].clearSailing + ' - ' + Math.round(listGus.totals.clearSailing/listGus.totals.public*100) + '%', langClassification[obj].pirateAction  + ' - ' + Math.round(listPirate.stats.total.public/listGus.totals.public*100) + '%']
    dataArray = [listGus.totals.clearSailing, listPirate.stats.total.public]

    if (gConfig.debugVerbose) consoleLogToFile('debug createCharts AllGuilds: ' + labelsArray)
    if (gConfig.debugVerbose) consoleLogToFile('debug createCharts AllGuilds: ' + dataArray)


    chart.setConfig({
        type:'doughnut',
        data:{
            labels: labelsArray,
            datasets:[{data: dataArray}]
        },
        options:{
            plugins:{
                doughnutlabel:{
                    labels:[{text:listGus.totals.public,font:{size:20}},{text:langBotswain[obj].pirateTablePublic}]
                },
                datalabels: {
                    color: '#fff'
                }
            }
        } 
    });    

    chart.toFile(gConfig.folderChart + obj + '/' + gConfig.jrnChrAllGuilds);
    wikiActionToPerform('upload', gConfig.folderChart + obj + '/' +  gConfig.jrnChrAllGuilds, gConfig.jrnChrAllGuilds)

    //////////////////////////////////////////////////////////////////////
    ////   Priate Action                                 /////////////////
    //////////////////////////////////////////////////////////////////////
    setTimeout(function (){
        labelsArray = []
        dataArray = []
       
        Object.keys(listPirate.stats.public).forEach(function(obj2, index2){
            labelsArray.push(langClassification[obj][obj2])
            dataArray.push(listPirate.stats.public[obj2])    
        });    

        if (gConfig.debugVerbose) consoleLogToFile('debug createCharts PirateAction: ' + labelsArray)
        if (gConfig.debugVerbose) consoleLogToFile('debug createCharts PirateAction: ' + dataArray) 

        chart.setConfig({
            type:'doughnut',
            data:{
                labels: labelsArray,
                datasets:[{data: dataArray}]
            },
            options:{
                plugins:{
                    doughnutlabel:{
                        labels:[{text:listPirate.stats.total.public,font:{size:20}},{text: langBotswain[obj].pirateTablePublic + ' ' + langClassification[obj].pirateAction}]
                    },
                    datalabels: {
                        color: '#fff'
                    }
                },
                legend: {
                    display: true,
                    position: 'right',
                    align: 'start'
                }
            } 
        });    

        chart.toFile(gConfig.folderChart + obj + '/' + gConfig.jrnChrPirateAction);
        wikiActionToPerform('upload', gConfig.folderChart + obj + '/' + gConfig.jrnChrPirateAction, gConfig.jrnChrPirateAction)
    }, gConfig.rl.chr.timeoutBasePeriod)


    //////////////////////////////////////////////////////////////////////
    ////   Non English Ships                             /////////////////
    //////////////////////////////////////////////////////////////////////
    setTimeout(function (){
        labelsArray = []
        dataArray = []
        tempTextArray = []
        
        Object.keys(listGus.totals.publicLang.langPrimary).forEach(function(obj2, index2){
            if ((listGus.totals.publicLang.langPrimary[obj2] > listGus.totals.publicLang.langAll) && (obj != obj2)) {
                if (listGus.totals.publicLang.langPrimary[obj2] - listGus.totals.publicLang.langAll > gConfig.jrnChrNonEnglishLimit) {
                    tempTextArray.push({'key': listGus.totals.publicLang.langPrimary[obj2], 'label': langGus[obj][obj2], 'data': listGus.totals.publicLang.langPrimary[obj2] - listGus.totals.publicLang.langAll})
                } else {
                    count += listGus.totals.publicLang.langPrimary[obj2] - listGus.totals.publicLang.langAll
                }
            }    
        });  

        _.orderBy(tempTextArray,['key'], ['desc']).forEach(function (obj4,index4){
            labelsArray.push(obj4.label)
            dataArray.push(obj4.data)
        });  

        if (count > 0) {
            labelsArray.push(langBotswain[obj].pirateOther)
            dataArray.push(count)            
        }  

        if (gConfig.debugVerbose) consoleLogToFile('debug createCharts NonEnglish: ' + labelsArray)
        if (gConfig.debugVerbose) consoleLogToFile('debug createCharts NonEnglish: ' + dataArray) 

        chart.setConfig({
            type:'horizontalBar',
            data:{
                labels: labelsArray,
                datasets:[{data: dataArray}]
            },
            options:{
                plugins:{
                    doughnutlabel:{
                        labels:[{text:listGus.totals.publicLang.langPrimaryNoEng + ' ' + langBotswain[obj].pirateGuilds + ' (' + Math.round(listGus.totals.publicLang.langPrimaryNoEng/listGus.totals.public*100) +'%)',font:{size:12}},{text:langBotswain[obj].pirateNonEnglish}]
                    },
                    datalabels: {
                        anchor: 'middle',
                        color: '#fff'
                    }
                },
                legend: {
                    display: false,
                },
                title: {
                    display: true,
                    text: langBotswain[obj].pirateNonEnglishTitle
                }
            } 
        });    

        chart.toFile(gConfig.folderChart + obj + '/' + gConfig.jrnChrNonEnglish);
        wikiActionToPerform('upload', gConfig.folderChart + obj + '/' + gConfig.jrnChrNonEnglish, gConfig.jrnChrNonEnglish)

    }, gConfig.rl.chr.timeoutBasePeriod*2)
 

    if (gConfig.debug) consoleLogToFile('debug createCharts END')
}


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   GUS (Guild Guide)                             /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function createJrnGus(){
    if (gConfig.debug) consoleLogToFile('debug createJrnGus START')
    var shipLimit = 0
    var gusText = ''
    var gusTextAlt = ''
    var tempFirstCx = false
    var tempFirstSubCx = false
    tempFirstCx_Footer = false
    var tempTextArray = []
    var tempText = ''

    //Create a list of Guild Classifications for each language.
    Object.values(listGus.guild).forEach(function(obj,index){
        Object.keys(langGus[gConfig.langDefault]).forEach(function(obj2, index2){
            if (obj.langPrimary.indexOf(obj2) >= 0){
                if (listGus_perLanguage[obj2] == undefined) {
                    listGus_perLanguage[obj2] = {}
                    listGus_count[obj2] = 0
                }
                if (listGus_perLanguage[obj2][obj.subclassification] == undefined) listGus_perLanguage[obj2][obj.subclassification] = []

                listGus_perLanguage[obj2][obj.subclassification].push(obj)
                listGus_count[obj2]++
            }
        });
    });

    //Sort List
    Object.keys(langGus[gConfig.langDefault]).forEach(function(obj,index){          
        if ( listGus_perLanguage[obj] != undefined) {
            Object.keys(listGus_perLanguage[obj]).forEach(function(obj2,index2){
                listGus_perLanguage[obj][obj2] = _.orderBy(listGus_perLanguage[obj][obj2],['memberCount'], ['desc']) //Alt: ['title'], ['asc']
            });
        }
    });


    //Create the Jounral (Wiki text)
    Object.keys(gConfig.langAvail).forEach(function(obj, index){
        gusText = ''
        gusText += prepLangString(langBotswain[obj].mainTopHeader, obj)
        gusText += prepLangString(langBotswain[obj].mainTopExplain, obj)
        if (listGus.totals.publicLang.langPrimary[obj] > gConfig.jrnGusShipShowAll){
            gusText += prepLangString(langBotswain[obj].mainTopLimitGuildsShown, obj)
        } else {
            gusText += prepLangString(langBotswain[obj].mainTopAllGuildsShown, obj)
        }
        gusText += prepLangString(langBotswain[obj].mainTopBreakdown, obj)
        gusText += prepLangString(langBotswain[obj].mainTopFooter, obj)

        Object.keys(listContent['classification']).forEach(function(obj2,index2){
            tempFirstCx = true
            tempFirstCx_Footer = false

            listContent['classification'][obj2].forEach(function(obj3,index3){            
                if (gConfig.debugVerbose) consoleLogToFile(langClassification[obj][obj3] )
                tempFirstSubCx = true

                if ((listGus_perLanguage[obj][obj3] != undefined) && (Object.keys(listGus_perLanguage[obj][obj3]).length > 0)){

                    if (listGus.totals.publicLang.langPrimary[obj] > gConfig.jrnGusShipShowAll){
                        if (Object.keys(gConfig.jrnGusShipLimitEx).indexOf(obj3)>=0){
                            shipLimit = gConfig.jrnGusShipLimitEx[obj3]
                        } else {
                            shipLimit = gConfig.jrnGusShipLimit
                        }
                    } else {
                        shipLimit = gConfig.jrnGusShipShowAll
                    }

                    if (shipLimit > 0 ){
                        tempTextArray =[]       
                        listGus_perLanguage[obj][obj3].every(obj4 => {
                            if (tempFirstCx) {
                                gusText+= '\n==' + langClassification[obj][obj2] + '=='
                                gusText+= '\n<div class="mw-collapsible" data-expandtext="' + langClassification[obj][obj2] + '" data-collapsetext="Hide ' + langClassification[obj][obj2] + '">'
                                tempFirstCx = false
                                tempFirstCx_Footer = true
                            }
                            if ((tempFirstSubCx) && (listContent['classification'][obj2].length > 1)){
                                gusText+= '\n===' + langClassification[obj][obj3] + '==='
                                tempFirstSubCx = false
                            }
                            
                            if (gConfig.debugVerbose) consoleLogToFile('Ship ' + shipLimit + ':  ' + obj4.title + '   #Membership Count: ' + obj4.memberCount)
                            
                            tempText =  '\n;' 
                            switch (obj4.memberColor){
                            case 'gold':
                                tempText+= '[[File:Gold-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                break;
                            case 'silver':
                                tempText+= '[[File:Silver-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                break;
                            case 'bronze':
                                tempText+= '[[File:Bronze-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                break;
                            default:    
                                consoleLogToFile(' **************** ERRROR - membersize not avaialble ****************')
                            }
                           
                            tempText+= '[' + obj4.url + ' '  + obj4.title  +']' + '\n: ' + obj4.summary

                            tempTextArray.push({'key': obj4.title, 'text': tempText}) 

                            shipLimit--

                            if (shipLimit <= 0){
                                return false; //time to stop
                            } else {
                                return true; 
                            }
                        }) //Finally listing the guild. 

                        //Quick clean up
                        _.orderBy(tempTextArray,['key'], ['asc']).forEach(function (obj4,index4){
                            gusText+= obj4.text
                        });  

                    }
                }
            }); //Content SubCx loop
            if (tempFirstCx_Footer) gusText+= '\n\n<div style="text-align: right;">[[#toc|Back to table of contents]]</div>{{clr}}\n</div>'
        }); //Content Cx Loop

        gusText += prepLangString(langBotswain[obj].mainFooter, obj)

        //////////////////////////////////////////////////////////////////////
        ////   Alt Text Guild Guide                        /////////////////
        //////////////////////////////////////////////////////////////////////
        gusTextAlt = ''
        gusTextAlt += prepLangString(langBotswain[obj].altTopHeader, obj)
        gusTextAlt += prepLangString(langBotswain[obj].altTopExplain, obj)
        gusTextAlt += prepLangString(langBotswain[obj].altTopAllGuildsShown, obj)
        gusTextAlt += prepLangString(langBotswain[obj].altTopBreakdown, obj)
        gusTextAlt += prepLangString(langBotswain[obj].altTopFooter, obj)

        //List Guilds by Language. If it looks familar it is. I may compress the code later
        Object.keys(langGus_altSort[obj]).forEach(function(objAlt, indexAlt){            
            if ((Object.keys(gConfig.langAvail).indexOf(objAlt) < 0) && (listGus_count[objAlt] > listGus.totals.publicLang.langAll)){
                //Only add if not alt page
                gusTextAlt += '\n==' + langGus[obj][objAlt] + '=='
                gusTextAlt+= '\n<div class="mw-collapsible" data-expandtext="' + langGus[obj][objAlt] + '" data-collapsetext="Hide ' + langGus[obj][objAlt] + '">'

                Object.keys(listContent['classification']).forEach(function(obj2,index2){
                    tempFirstCx = true

                    listContent['classification'][obj2].forEach(function(obj3,index3){            
                        if (gConfig.debugVerbose) consoleLogToFile(langClassification[obj][obj3] )

                        if ((listGus_perLanguage[objAlt][obj3] != undefined) && (Object.keys(listGus_perLanguage[objAlt][obj3]).length > 0)){
                            tempFirstSubCx = true

                            tempTextArray = []
                            listGus_perLanguage[objAlt][obj3].every(obj4 => {
                                if (!(obj4.langAll)){
                                    if (tempFirstCx) {
                                        gusTextAlt+= '\n===' + langClassification[obj][obj2] + '==='
                                        tempFirstCx = 0
                                    }
                                    if ((tempFirstSubCx) && (listContent['classification'][obj2].length > 1)) {
                                        gusTextAlt+= '\n====' + langClassification[obj][obj3] + '===='
                                        tempFirstSubCx = false
                                    }

                                    if (gConfig.debugVerbose) consoleLogToFile(obj4.title + '   #Membership Count: ' + obj4.memberCount)

                                    if (gConfig.debugVerbose) consoleLogToFile('Ship ' + shipLimit + ':  ' + obj4.title + '   #Membership Count: ' + obj4.memberCount)
                                    
                                    tempText =  '\n;' 
                                    switch (obj4.memberColor){
                                    case 'gold':
                                        tempText+= '[[File:Gold-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                        break;
                                    case 'silver':
                                        tempText+= '[[File:Silver-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                        break;
                                    case 'bronze':
                                        tempText+= '[[File:Bronze-guild-badge-small.png|40px|alt=Gold guild badge]]'
                                        break;
                                    default:    
                                        consoleLogToFile(' **************** ERRROR - membersize not avaialble ****************')
                                    }
                           
                                    tempText+= '[' + obj4.url + ' '  + obj4.title  +']' + '\n: ' + obj4.summary


                                    tempTextArray.push({'key': obj4.title, 'text': tempText}) 
                                }

                                return true; //We are doing the lot here (Yes I cheated and rip some code I did before
                            }); //Finally listing the guild.   

                            //Quick clean up
                            _.orderBy(tempTextArray,['key'], ['asc']).forEach(function (obj4,index4){
                                gusTextAlt+= obj4.text
                            });  
                        }
                    }); //Content SubCx loop
                }); //Content Cx Loop

                gusTextAlt+= '\n\n<div style="text-align: right;">[[#toc|Back to table of contents]]</div>{{clr}}\n</div>'  
            }
        });

        gusTextAlt += prepLangString(langBotswain[obj].altFooter, obj)

        wikiActionToPerform('edit', gusText, gConfig.langAvail[obj].jrnPgeGus)
        wikiActionToPerform('edit', gusTextAlt, gConfig.langAvail[obj].jrnPgeGusAlt)
    }); //Lang Avail Loop

    if (gConfig.debug) consoleLogToFile('*******************************************')
    if (gConfig.debug) consoleLogToFile('*******************************************')
    if (gConfig.debug) consoleLogToFile('*******************************************')
    if (gConfig.debug) consoleLogToFile('*******************************************')
    if (gConfig.debug) consoleLogToFile('')

    createJrnSocialite()

    if (gConfig.debug) consoleLogToFile('debug createJrnGus END')
    //wikiActionToPerform('edit', gusText, 'User:Botswain/Sandbox')
}    


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   Markdown Output                              /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function createJrnSocialite(){
    if (gConfig.debug) consoleLogToFile('debug createJrnSocialite START')
    var mText = ''
    var tempTextArray = []
    var obj = 'en' //I'm copying code and want to do this quick.

    mText += prepLangString(langBotswain[obj].socialiteTopHeader, obj)
    mText += prepLangString(langBotswain[obj].socialiteTopExplain, obj)  
    mText += prepLangString(langBotswain[obj].socialiteTopInstruction, obj)  
    mText += prepLangString(langBotswain[obj].socialiteTopFooter, obj)    

    Object.keys(langGus_altSort[obj]).forEach(function(objAlt, indexAlt){            
        if ((listGus_count[objAlt] > listGus.totals.publicLang.langAll) && (obj != objAlt)){
            tempTextArray = []
            Object.keys(listContent['classification']).forEach(function(obj2,index2){
                listContent['classification'][obj2].forEach(function(obj3,index3){             
                    if ((listGus_perLanguage[objAlt][obj3] != undefined) && (Object.keys(listGus_perLanguage[objAlt][obj3]).length > 0) && (obj3 != 'subWorldH_ContributorGuilds')){

                        listGus_perLanguage[objAlt][obj3].every(obj4 => {
                            if (gConfig.debugVerbose) consoleLogToFile('Markdown: ' +obj4.title + '   #Membership Count: ' + obj4.memberCount)
                            
                            if (!(obj4.langAll)) tempTextArray.push({'key': obj4.memberCount, 'text': '\n + [' + obj4.title.replace(/(\[)/gm, '').replace(/(\])/gm, '')  + ']('  + obj4.url  +')'}) 
                            
                            return true; //We are doing the lot here (Yes I cheated and rip some code I did before
                        }); //Finally listing the guild.   

                        //Quick clean up

                    }
                }); //Content SubCx loop
            }); //Content Cx Loop
/*
            mText+='\n************************************************'
            mText+='\n*    ' + langGus[obj][objAlt]
            mText+='\n************************************************'
*/
            mText+='\n\n== ' +  langGus[obj][objAlt] + ' =='   
            '\n<div class="mw-collapsible" data-expandtext="' + langGus[obj][objAlt] + '" data-collapsetext="Hide ' + langGus[obj][objAlt] + '">'

            if (gConfig.langSocialite.indexOf(objAlt) >= 0){
                mText+='\n ' + langSocialite[objAlt].greeting
            } else {
                mText+='\n ' + langSocialite[obj].greeting
            }

            _.orderBy(tempTextArray,['key'], ['desc']).forEach(function (obj4,index4){
                mText+= obj4.text
            });  
            mText+='\n\n<div style="text-align: right;">[[#toc|Back to table of contents]]</div>{{clr}}\n</div>'
                    
        }

    });

    wikiActionToPerform('edit', mText, gConfig.jrnPgeSocialite)
}


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   Pirate Action                                 /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function createJrnPirate(){
    if (gConfig.debug) consoleLogToFile('debug createJrnPirate START')

    var pirateText = ''
    var tempTextArray = []
    var tempText = ''


    pirateText+= prepLangString(langBotswain[gConfig.langDefault].pirateHeader, gConfig.langDefault)
    pirateText+= prepLangString(langBotswain[gConfig.langDefault].pirateExplain, gConfig.langDefault)

    Object.keys(listPirate.guilds).forEach(function(obj, index){
        if (gConfig.debugVerbose) consoleLogToFile('debug createJrnPirate ' + obj)
        pirateText+= '\n\n== ' + langClassification[gConfig.langDefault][obj] + ' ==' //Always have a header 
        pirateText+= '\n<div class="mw-collapsible" data-expandtext="' + langClassification[gConfig.langDefault][obj] + '" data-collapsetext="Hide ' + langClassification[gConfig.langDefault][obj] + '">'
        tempTextArray = []

        listPirate.guilds[obj].forEach(function(obj2, index2){
            tempText =  '\n;[' + obj2.url + ' '  + obj2.name  +']' + '\n: Action Started: ' + moment(obj2.actionStarted).format('D MMM YYYY')
            if (obj2.hailed != undefined) tempText+= '\n: Hailed: ' + moment(obj2.hailed).format('D MMM YYYY')
            if (obj2.return != undefined) tempText+= '\n: Return: ' + moment(obj2.return).format('D MMM YYYY')
            if (obj2.raiseAnchor != undefined) tempText+= '\n: Raise Anchor: ' + moment(obj2.raiseAnchor).format('D MMM YYYY')
            tempTextArray.push({'key': obj2.name, 'text': tempText}) 
        });

        _.orderBy(tempTextArray,['key'], ['asc']).forEach(function (obj2,index2){
            pirateText+= obj2.text
        });
        pirateText+='\n\n<div style="text-align: right;">[[#top|Back to top]]</div>{{clr}}\n</div>'
    });

    wikiActionToPerform('edit', pirateText, gConfig.jrnPgePirate)

    if (gConfig.debug) consoleLogToFile('debug createJrnPirate END')
}    


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
////   GUS Categories                                /////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
function createJrnGusCx(){
    if (gConfig.debug) consoleLogToFile('debug createJrnGusCx START')
    var gusCxText = ''

    Object.keys(gConfig.langAvail).forEach(function(obj, index){
        gusCxText+= prepLangString(langBotswain[obj].gusCxHeader, obj)
        gusCxText+= prepLangString(langBotswain[obj].gusCxExplain, obj)

        Object.keys(listContent['classification']).forEach(function(obj2, index2){
            gusCxText+= '\n\n==' + langClassification[obj][obj2] + '=='
            gusCxText+= '\n<div class="mw-collapsible" data-expandtext="' + langClassification[obj][obj2] + '" data-collapsetext="Hide ' + langClassification[obj][obj2] + '">'

            listContent['classification'][obj2].forEach(function(obj3, index3){        
                if (gConfig.debugVerboase) consoleLogToFile('createJrnGusCx: ' + obj3)          


                gusCxText+= '\n===' + langClassification[obj][obj3] + '==='                              
                gusCxText+= '\n' + prepLangString(langClassification[obj][('sum' + obj3.substring(0,1).toUpperCase() + obj3.substring(1,900)).trim()],obj)
            });
            gusCxText+= '\n\n<div style="text-align: right;">[[#toc|Back to table of contents]]</div>{{clr}}\n</div>'
        });
        //fs.writeFileSync('zt_' + obj + '_GUS', gusCxText);  //$$ Temp
        wikiActionToPerform('edit', gusCxText, gConfig.langAvail[obj].jrnPgeGusCx)
    });

    if (gConfig.debug) consoleLogToFile('debug createJrnGusCx END')
}



///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////
////  API call functions                          ////////////
//////////////////////////////////////////////////////////////	

//Edit Page
// Make sure it more than 1 second since last call here.

//Code below has been adapated from 
// https://www.mediawiki.org/wiki/API:Edit#JavaScript
// https://www.mediawiki.org/wiki/API:Upload#JavaScript


function wikiActionToPerform(wikiAction, itemToAction, target){
    if (gConfig.debugVerbose) consoleLogToFile('debug wikiActionToPerform START for ' + wikiAction + ' for target: ' + target)

    var timeoutPeriod = 0

    if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Current Time: ' + moment().utc())
    if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Last Wiki Edit: ' + moment(lastWikiAction))
    if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Last Wiki Edit + Timeout After? ' + moment(lastWikiAction).add(gConfig.rl.jrn.timeoutMinPeriod, 'ms'))
    if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Wait?: ' + moment().utc().isBefore(moment(lastWikiAction).add(gConfig.rl.jrn.timeoutMinPeriod, 'ms')))

    if (moment().utc().isBefore(moment(lastWikiAction).add(gConfig.rl.jrn.timeoutMinPeriod, 'ms'))) {
        if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Reset Timeout')
        if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: Min time to add:' + moment(lastWikiAction).add(gConfig.rl.jrn.timeoutMinPeriod).diff(moment().utc(), 'ms'))
        timeoutPeriod = moment(lastWikiAction).add(gConfig.rl.jrn.timeoutMinPeriod).diff(moment().utc(), 'ms') + Math.floor((Math.random() * gConfig.rl.jrn.timeoutBasePeriod) + 1);
    }
    if (gConfig.debugAPI) consoleLogToFile('wikiActionToPerform: TimeOutPeriod: '+ timeoutPeriod)
    lastWikiAction = moment().utc().add(timeoutPeriod, 'ms') + Math.floor((Math.random() * gConfig.rl.jrn.timeoutBasePeriod) + 1) // Add some extra space

    setTimeout(function (){
        if (gConfig.debugVerbose) consoleLogToFile(target)
        getLoginToken()
    }, timeoutPeriod); 

    function getLoginToken() {
        var params_0 = {
            action: 'query',
            meta: 'tokens',
            type: 'login',
            format: 'json'
        };

        request.get({ url: gConfig.jrnServerUrl, qs: params_0 }, function (error, res, body) {
            if (error) {
                return;
            }
            var data = JSON.parse(body);
            loginRequest(data.query.tokens.logintoken);
        });
    }

    // Step 2: POST request to log in. 
    // Use of main account for login is not
    // supported. Obtain credentials via Special:BotPasswords
    // (Special:BotPasswords) for lgname & lgpassword
    function loginRequest(login_token) {
        var params_1 = {
            action: 'login',
		lgname: jrnName,
		lgpassword: jrnPWord,
        lgtoken: login_token,
        format: 'json'
        };

        request.post({ url: gConfig.jrnServerUrl, form: params_1 }, function (error, res, body) {
            if (error) {
                return;
            }
            getCsrfToken();
        });
    }

    // Step 3: GET request to fetch CSRF token
    function getCsrfToken() {
        var params_2 = {
            action: 'query',
            meta: 'tokens',
            format: 'json'
        };

        request.get({ url: gConfig.jrnServerUrl, qs: params_2 }, function(error, res, body) {
            if (error) {
                return;
            }
            var data = JSON.parse(body);
            if (gConfig.debugAPI) consoleLogToFile(data.query.tokens.csrftoken)
            switch(wikiAction){
            case 'edit':
                editRequest(data.query.tokens.csrftoken);
                break;
            case 'upload':
                upload(data.query.tokens.csrftoken);
                break;
            default:
                consoleLogToFile(' ************* ERROR Unknown Wiki Action ***********')
            }
            
        });
    }

    // Step 4: POST request to edit a page
    function editRequest(csrf_token) {
        var params_3 = {
            action: 'edit',
            title: target,
            text: itemToAction,
            summary: gConfig.jrnActionEditComment,
            contentformat: 'text/x-wiki',
            token: csrf_token,
            format: 'json'
        };

        request.post({ url: gConfig.jrnServerUrl, form: params_3 }, function (error, res, body) {
            if (error) {
                return;
            }
            if (gConfig.debugVerbose) consoleLogToFile(body);
        });
    }

    function upload(csrf_token) {
        var params_3 = {
            action: 'upload',
            filename: target,
            comment: gConfig.jrnActionUploadComment,
            text: gConfig.jrnActionUploadTextNew,
            ignorewarnings: '1',
            token: csrf_token,
            format: 'json'
        };

        var file = {
            file: fs.createReadStream(itemToAction)
        };

        var formData = Object.assign( {}, params_3, file );

        request.post({ url: gConfig.jrnServerUrl, formData: formData }, function (error, res, body) {
            body = JSON.parse(body);
            if (error) {
                return;
            } else { 
                if ((body.error != undefined) && (body.error.code == 'fileexists-no-change')){
                    if (gConfig.debugVerbose) consoleLogToFile('File Not Uploaded Due to Duplicate: '+ target);
                } else if (body.upload == undefined){
                    consoleLogToFile('ERROR! No Uploade information for: '+ target);
                    console.log(body)
                } else { 
                    if (body.upload.result === 'Success'){
                        if (gConfig.debugVerbose) consoleLogToFile('wikiActionToPerform: File Uploaded : '+ target);
                    }
                }
            }
        });
    }
}




///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////
////  Log To File functions                               ////////////
//////////////////////////////////////////////////////////////	
function consoleLogInitFile(stringToOutput){
    if (gConfig.fileOutput){
        var fileToOutput 
        //Rotate files
        if (gConfig.outputLogMax > 1){
            for (var i = gConfig.outputLogMax; i > 1; i -= 1){
                fileToReplace = gConfig.outputLogPrefix + ('0' + i).slice(-2) + gConfig.outputLogSuffix 
                fileToOutput = gConfig.outputLogPrefix + ('0' + (i-1)).slice(-2) + gConfig.outputLogSuffix

                if (fs.existsSync(fileToOutput)){
                    //file exists
                } else {
                    fs.writeFileSync(fileToOutput, 'Missing File' + i)
                }

                fs.rename(fileToOutput, fileToReplace, function(err){
                        if (gConfig.debugConsole) if (err) console.log(err);
                });
            }
        } else {
            fileToOutput = gConfig.outputLogPrefix + '01' + gConfig.outputLogSuffix
        }
        
        streamConsole = fs.createWriteStream(fileToOutput)
        streamConsole.write(stringToOutput, function(err, data){
            if (gConfig.debugConsole) if (err) console.log(err);
            if (gConfig.debugConsole) console.log('Successfully Written to File.');
        });
    } else {    
        console.log(stringToOutput)
    }
}

function consoleLogToFile(stringToOutput){
    if (gConfig.fileOutput){
        streamConsole.write(stringToOutput + '\n', function(err, data){
            if (gConfig.debugConsole) if (err) console.log(err);
        });
    } else {
        console.log(stringToOutput)
    }  
}





///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////
////    Replaces variable strings for Messages
//////////////////////////////////////////////////////////////////////
function prepLangString(strToModify, lang){
    var result = strToModify
    var tempStr = ''
    var tempStrAlt = ''
    var tempCount = 0
    var tempTest = false
    var tempTextArray = []
    var i = 0

    if (result ==  undefined) result = ''

    if (langGus[lang] != undefined){
        result = result.replace(/<%= langCurrent %>/gm, langGus[lang][lang])
    } else {
        result = result.replace(/<%= langCurrent %>/gm, langGus[gConfig.langDefault][lang])
    }


    result = result.replace(/<%= limitDefault %>/gm, gConfig.jrnGusShipLimit)

    if (strToModify.indexOf('<%= listOfAltGuildPages %>') >= 0){
        var tempStr = ''

        Object.keys(langGus_altSort[lang]).forEach(function(obj, index){
            //Check if there is more than the default langauges  
            if (obj != lang){
                if (listGus_count[obj] > listGus.totals.publicLang.langAll){
                    if (Object.keys(gConfig.langAvail).indexOf(obj) >= 0){
                        tempStr+= '\n* [[' + gConfig.langAvail[obj].jrnPgeGus + ' | ' + langGus[lang][obj] + ']]'
                    } else {
                        tempStr+= '\n* [[' + gConfig.langAvail[lang].jrnPgeGusAlt + '#' + langGus[lang][obj] + ' | ' + langGus[lang][obj] + ']]'
                    }
                }
            }
        });
        result = result.replace(/<%= listOfAltGuildPages %>/gm, tempStr)
    }

    if (strToModify.indexOf('<%= langCountrySection %>') >= 0){
        tempStr = ''
        tempCount = 0
        tempTest = false

        Object.keys(listGus_perLanguage[lang]).forEach(function(obj, index){
            tempTest = false

            Object.keys(listContent['classification']).forEach(function (obj2, index2){  
                if (listContent['classification'][obj2].indexOf(obj) >= 0) if (obj2 == gConfig.altCountrySectionCx) tempTest = true
            });
            if ((obj == gConfig.altCountrySectionCx) || (tempTest)){
                tempCount+= listGus_perLanguage[lang][obj].length
            }    
        });

        if (tempCount >= gConfig.altCountrySectionCxLimitShow) {
                tempStr+= langBotswain[lang].langCountrySection
                tempStr = tempStr.replace(/<%= langCountrySectionName %>/gm, '[[#' + langClassification[lang][gConfig.altCountrySectionCx] + ' | ' + langClassification[lang][gConfig.altCountrySectionCx] + ']]')
        }

        result = result.replace(/<%= langCountrySection %>/gm, tempStr)
    }


    if ((strToModify.indexOf('<%= listLinkLangGuildPages %>') >= 0) || (strToModify.indexOf('<%= listLinkLangAltGuildPages %>') >= 0)){
        tempStr = ''
        tempStrAlt = ''
        Object.keys(gConfig.langAvail).forEach(function(obj, index){
            if (obj != lang){
                tempStr+= '\n[[' + gConfig.langAvail[obj].jrnPgeGus + ']]'
                tempStrAlt+= '\n[[' + gConfig.langAvail[obj].jrnPgeGusAlt + ']]'
            }
        });
        result = result.replace(/<%= listLinkLangGuildPages %>/gm, tempStr)
        result = result.replace(/<%= listLinkLangAltGuildPages %>/gm, tempStrAlt)
    }

    if ((strToModify.indexOf('<%= jrnPgeGusCx %>') >= 0)){
        if (Object.keys(gConfig.langAvail).indexOf(lang) >= 0){
            result = result.replace(/<%= jrnPgeGusCx %>/gm, gConfig.langAvail[lang].jrnPgeGusCx)
        } else {
            result = result.replace(/<%= jrnPgeGusCx %>/gm, gConfig.langAvail[gConfig.langDefault].jrnPgeGusCx)
        }
    }    
    

    if (strToModify.indexOf('<%= listOfAltGuildPagesWithCount %>') >= 0){
        tempTextArray = []
        Object.keys(listGus_count).forEach(function(obj, index){
            if (listGus_count[obj] > listGus.totals.publicLang.langAll){
                if (Object.keys(gConfig.langAvail).indexOf(obj) >= 0){
                    tempStr = '[[' + gConfig.langAvail[obj].jrnPgeGus + ' | ' + langGus[lang][obj] +  ']]'
                } else {
                    tempStr = '[[#' + langGus[lang][obj] + ' | ' + langGus[lang][obj] +  ']]'
                }
                tempTextArray.push({'key': listGus_count[obj], 'text': '\n|- \n| ' + tempStr + ' \n| ' + (listGus_count[obj] - listGus.totals.publicLang.langAll) })
            }
        });

        tempStr = ''
        tempStr+= '\n\n{|class="wikitable sortable"'
        tempStr+= '\n!' + langBotswain[lang].tableLanguage
        tempStr+= '\n!' + langBotswain[lang].tableCount
         _.orderBy(tempTextArray,['key'], ['desc']).forEach(function (obj, index){
            tempStr+= obj.text
        })
        tempStr+='\n|}'
        result = result.replace(/<%= listOfAltGuildPagesWithCount %>/gm, tempStr)
    }

    if (strToModify.indexOf('<%= listOfAllPirateShipsWithCount %>') >= 0){
        tempTextArray = []
        i=0
        Object.keys(listPirate.stats.public).forEach(function(obj, index){
            i++

            tempTextArray.push({'key': i, 'text': '\n|- \n| ' + '[[#' + langClassification[lang][obj] + '|' + langClassification[lang][obj] + ']]'  + ' \n|style="text-align:right;"| ' + listPirate.stats.public[obj] + '\n|style="text-align:right;"| ' + listPirate.stats.private[obj] })
        
        });

        tempStr = ''
        tempStr+= '\n\n{|class="wikitable"'
        tempStr+= '\n!' + langBotswain[lang].pirateTableAction  
        tempStr+= '\n!' + langBotswain[lang].pirateTablePublic
        tempStr+= '\n!' + langBotswain[lang].pirateTablePrivate
         _.orderBy(tempTextArray,['key'], ['asc']).forEach(function (obj, index){
            tempStr+= obj.text
        })
        tempStr+='\n|-style="font-weight: bold;" \n| ' + langBotswain[lang].pirateTableTotal + ' \n|style="text-align:right;"| <%= countPiratePublic %>\n|style="text-align:right;"| <%= countPiratePrivate %>'
        tempStr+='\n|-" \n| ' + '[[#' + langClassification[lang]['droppedAnchor'] + '|' + langBotswain[lang].pirateTableDropAnchor + ']] \n|style="text-align:right;"| <%= countPiratePublicDropAnchor %>\n|style="text-align:right;"| <%= countPiratePrivateDropAnchor %>'
        tempStr+='\n|}'
        result = result.replace(/<%= listOfAllPirateShipsWithCount %>/gm, tempStr)
    }

    result = prepString(result)

    return result
}


function prepString(strToModify){

    var result = strToModify

    result = result.replace(/<%= n %>/gm,'\n' )
    result = result.replace(/<%= dateLastUpdate %>/gm, moment(listGus.lastupdated).format('yyyy-MM-DD') )
    result = result.replace(/<%= dateLastUpdatePirate %>/gm, moment(listPirate.lastupdated).format('D MMM yyyy') )

    result = result.replace(/<%= countPublic %>/gm, listGus.totals.public )
    result = result.replace(/<%= countClearSailing %>/gm, listGus.totals.clearSailing )

    result = result.replace(/<%= countGold %>/gm, listGus.totals.sizeBreakdown.gold )
    result = result.replace(/<%= countSilver %>/gm, listGus.totals.sizeBreakdown.silver )
    result = result.replace(/<%= countBronze %>/gm, listGus.totals.sizeBreakdown.bronze )
    result = result.replace(/<%= countGoldPercent %>/gm, Math.round(listGus.totals.sizeBreakdown.gold / listGus.totals.public*100) )
    result = result.replace(/<%= countSilverPercent %>/gm, Math.round(listGus.totals.sizeBreakdown.silver / listGus.totals.public*100) )
    result = result.replace(/<%= countBronzePercent %>/gm, Math.round(listGus.totals.sizeBreakdown.bronze / listGus.totals.public*100) )


    result = result.replace(/<%= sizeGold %>/gm, listContent.size.sizeGold )
    result = result.replace(/<%= sizeSilver %>/gm, listContent.size.sizeSilver )
    result = result.replace(/<%= sizeBronze %>/gm, listContent.size.sizeBronze )


    result = result.replace(/<%= countPirate %>/gm, listPirate.stats.total.public + listPirate.stats.total.private)
    result = result.replace(/<%= countPiratePublic %>/gm, listPirate.stats.total.public)
    result = result.replace(/<%= countPiratePrivate %>/gm, listPirate.stats.total.private )
    result = result.replace(/<%= countPiratePublicDropAnchor %>/gm, listPirate.stats.droppedAnchor.public )
    result = result.replace(/<%= countPiratePrivateDropAnchor %>/gm, listPirate.stats.droppedAnchor.private )

    result = result.replace(/<%= jrnPgePirate %>/gm, gConfig.jrnPgePirate)

    return result

}

}}; //End of the modcule Export