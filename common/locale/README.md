# Habitica-Pirate-Tools Language Translations

Due to the nature of GuildBot and the pirates, @Guildbot does not handle language variants. For example, it hard for @GuildBot, the pirates (and even Google) to tell if a Portuguese guild is Brazilian variant or Portuguese. Currently Boatswain does not need variants, as all the wikis are single variant per language. 

It is envisioned, once GUS and ERIC join the crew, variants will be required for their text.

Current files 
+ **botswain.json**: Used by botswain code to populate wiki pages and charts.
+ **botswain_socialite.json**: Used by botswain code for the Socialites Markdown List. This file is separate so linguist of languages without a foreign wiki does not need to translate botswain.json.
+ **classification.json**:  List of all classification, subs and summaries. Used by botswain code.
+ **guildbot.json**: Used by guildbot code for hails.
+ **gusLang.json**: Language names of gus. Please note this file only matches the labels in trello. It does not contain variants.. Used by botswain code.
+ **gusText.json**: Text of GUS App. Used by gus code. (Not yet finalised)