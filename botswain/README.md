# Habitica-Pirate-Tools
Tools for the Pirates of Pirate Cove at [Habitica](http://www.habitica.com).

This is the folder for Botswain - Pirate wiki Bot. 

It primary responsibilities is to update the 
+ [Guild Guides](https://habitica.fandom.com/wiki/Guilds_Guide) 
+ [Guilds Guide Of Non-English Guilds](https://habitica.fandom.com/wiki/Guilds_Guide_Of_Non-English_Guilds)
+ [Gus Classifications](https://habitica.fandom.com/wiki/The_Keep:Pirate_Cove/GUS_Classifications)
+ [Pirate Cove's Current Actions](https://habitica.fandom.com/wiki/The_Keep:Pirate_Cove/Current_Actions)
+ [Socialites Markdown List for Non-English Guilds](https://habitica.fandom.com/wiki/Socialites_Markdown_List_for_Non-English_Guilds)

## Run command
botswain.js is the core code. The primary command is botswain.completeRun.
Parameters are:
+ **modeEnvironment**: config environment to run, 
+ **jrnName**: Wiki User Name as per https://habitica.fandom.com/wiki/Special:BotPasswords
+ **jrnPWord**: Wiki Password as generated from https://habitica.fandom.com/wiki/Special:BotPasswords.
  

### Example
botswain.completeRun('testing', 'WIKI-BOTSWAIN-USERNAME', 'WIKI-BOTSWAIN-PASSWORD')

## config.json
Parameter file to run for Botswain. Each top level key. is a particular mode for Botswain to run in. Only the *production* key needs to have all the values set. New modes can be created without the need to alter the code. just add a new top level key. 

### Key Descriptions
+ **folderOutput**: folder for log files and master tracking file.
+ **folderStat**: Stats folder location; Publicly available statistic files produced by Botswain.
+ **folderChart**: Charts produced by Botswain per language (Currently only in English)
+ **folderLang**: Folder where language file translations to keep.

+ **outputFilePrefix**: Output prefix to allow for testing.
+ **outputLogSuffix**: Output Log file suffix.
+ **outputLogMax**:  Number of log files to keep. (Typically 16 to keep just over 2 weeks worth).

+ **fileLang**: Files used for Botswain.
+ **fileLangClassification**: GUS Classifications names and Summaries (created per locale)
+ **fileSocialite**: File used for *Socialites Markdown List for Non-English Guilds*. This is the single phrased that is translated in multiple languages.

+ **langAvail**: Languages available for wiki translations. Array of objects with id is the two language code. Object contains the following keys, **jrnPgeGus**: Page where Guilds Guide is, **jrnPgeGusAlt**: Page where Alternative Language Guilds Guide, **jrnPgeGusCx**: Page where Gus Classifications are. Example `"en": {"transLang": "en" , "jrnPgeGus": "Guilds_Guide", "jrnPgeGusAlt": "Guilds_Guide_Of_Non-English_Guilds", "jrnPgeGusCx": "The_Keep:Pirate_Cove/GUS_Classifications"}`. This relates to the file fileLang in the locale file. Please note if language variants are needed like pt-br this is where you would add it.
+ **langSocialite**: Languages available for  translations. Two language code kept in array. Eg. [*en*. *de*. *fr*]. To add a new one please see ensure the file as specified by fileSocialite exists for the language.
+ **langDefault**: Default 2 language code. Should be en for English.

+ **jrnPgePirate**: Pirate Current Actions
+ **jrnPgeSocialite**: Socialite Markdown page

+ **jrnChrAllGuilds**: Chart that appears in Pirate Guild and wiki's Pirate Current Actions. Shows All Guilds Vs Pirate Actions.
+ **jrnChrPirateAction**: Chart that appears in Pirate Guild and wiki's Pirate Current Actions. Shows breakdown per Pirate Actions.
+ **jrnChrNonEnglish**: Chart that appears in Pirate Guild and wiki's Pirate Current Actions. Shows a barchart of each of the languages.
+ **jrnChrNonEnglishLimit**: Total number of guilds equal to or less than this number appear in the Other column of the chart jrnChrNonEnglish.

+ **jrnGusShipShowAll**: Number of guilds equal to or less than this number will show all guilds on the page. If greater than, will limit the number based on the jrnGusShipLimit and jrnGusShipLimitEx.
+ **jrnGusShipLimit**: Limit of guilds per GUS Classification if not showing all guilds.
+ **jrnGusShipLimitEx**: Exceptions to GUS Classifications limit for specific guild sub categories. (Object with key as the subcx name and value the guild limit).

+ **altCountrySectionCx**: Section name to show and check for Alternative Languages Paragraph on jrnPgeGus
+ **altCountrySectionCxLimitShow**: If the total number of guilds is greater than this number the Alternative Languages Paragraph will show on jrnPgeGus.


+ **jrnServerUrl**: Wiki Server URL
+ **jrnActionEditComment**: Comment posted when updating wiki pages.
+ **jrnActionUploadComment**: Comment when uploading files.
+ **jrnActionUploadTextNew**: Text when uploading file for the first time.

+ **rl**: API base reset details.  

+ **debug**: Show debug information.
+ **debugVerbose**: Show verbose debug information.
+ **debugConsole**: Show debug information to console. (Useful if testing and need to see it is running).
+ **debugAPI**: Show detail debug information with the API. (Useful to help with timeouts etc).
+ **fileOutput**: All debug information (except debugConsole) to output files. 

## External Language Input
+ **botswain.json (fileLang)**: Text used by wiki pages and charts
+ **botswain_socialite.json (fileSocialite)**: Text used for the Socialite greeting phrase. (This appears on the jrnPgeSocialite page. This is a separate file as many of the languages will not require botswain.json as they currently do not have a wiki.
+ **classification.json (fileLangClassification)**: Language translation file of all classifications, sub-classifications and their summaries.
+ **gusLang.json (fileLangGus)**: Language file listing all the gus languages. Note, this must match up to the Trello labels for guildBot.json. No variants are to exists and should be languages actively spoken where English is unlikely to be used as a primary language. (Ie Welsh should not be included).

## External Stat Input
+ gus.json 
+ pirate.json
+ content.json (The order of classification is important in this file as they will be replicated on the wiki page)