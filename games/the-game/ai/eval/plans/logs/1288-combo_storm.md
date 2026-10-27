# Run 1288, combo_storm: the 9 losses

Every decision in the last 400 frames of each lost game, from its survivor.log (run 40426699902, commit 93c45b79).

- `sooner=line:lost:kRULE` -- the line played loses sooner than `line`, which the order ranked under it by RULE (k2 margin, k4 list, k5 value).
- `mgs=` -- each line's four shares in rows: room.material.window.contact, in the order of `opts`.
- `opts=` -- the lines offered, ranked: play:lost-at (L = lives):broke.

## combo_storm-1, lost at 20226

```
19829 play=carry v=dies under=0 mat=27 land=101 dies=152 w3=1/w mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=carry*:207:0:e312,hold:152:0:n,carry:161:0,survive:161:0,carry:152:0,survive:152:0,survive:207:0,carry~:155:0:b2
19854 play=carry v=dies under=0 mat=27 land=76 dies=127 w3=1/w mgs=0.3.12.2,0.3.12.4,0.3.12.4,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=carry*:182:0:e287,survive:202:0,survive:146:0,hold:127:0,clear:127:0,carry:136:0,carry~:130:0:b2
19896 play=level v=dies under=0 mat=24 land=84 dies=94 w3=0 sooner=carry:140:k2.margin mgs=0.3.12.4,0.3.12.4,0.3.12.2,0.2.12.4,0.3.12.2,0.3.12.2 opts=level:104:0,survive:109:0,carry*~:140:0:e245:b1,survive~:213:0:b1,carry~:140:0:b1,hold:94:0
19909 play=survive v=dies under=0 mat=24 land=71 dies=91 w3=1/w mgs=0.3.12.4,0.3.12.4,0.3.12.4,0.3.12.4,0.3.12.4,0.3.12.4 opts=survive~:150:0,carry~:140:0,survive~:146:0,survive:96:0,survive:93:0,hold:91:0
19939 play=setup v=dies under=1 mat=21 land=41 dies=63 w3=0 mgs=0.3.12.4,6.3.12.0,0.3.12.4,6.3.12.0 opts=setup:67:0:e177,level:70:0,hold:63:0,clear:63:0
19954 play=setup v=dies under=1 mat=21 land=26 dies=52 w3=0 mgs=0.3.12.2,6.3.12.4,6.3.12.4,0.3.12.4 opts=setup:55:0:einf,break_search:67:0,level:59:0,hold:52:0
19977 play=toward v=dies under=1 mat=21 land=3 dies=32 w3=1/w mgs=3.3.12.2,0.2.12.6,3.3.12.2,3.3.12.2,3.3.12.2,3.3.12.2,0.3.12.2 opts=toward:224:0,survive~:166:0:b1,level:47:0,toward:40:0,level:36:0,survive:36:0,hold:32:0
20001 play=toward v=dies under=1 mat=21 land=0 dies=1 w3=1/w mgs=0.3.0.2,0.3.0.2,0.2.0.6,0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2 opts=toward:200:0,carry*:200:0:b1,survive~:200:0:b1,hold:16:0,level:16:0,survive:16:0,level:16:0,toward:16:0
20029 play=toward v=dies under=1 mat=21 land=39 dies=40 w3=0 mgs=0.3.0.2,0.3.0.2,0.2.0.6,0.3.0.2,0.3.0.2 opts=toward:172:0,carry*:172:0:b1,survive~:172:0:b1,hold:45:0,level:45:0
20061 play=clear v=dies under=1 mat=21 land=7 dies=8 w3=0 mgs=0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2,0.3.0.2,0.2.0.6 opts=clear:140:0,clear:140:0,clear:140:0,clear:140:0,clear:140:0,clear:140:0,carry*:140:0:b1,survive~:140:0:b1
20077 play=level v=dies under=1 mat=18 land=124 dies=124 w3=0 mgs=0.2.12.12,0.2.12.12,0.2.12.12,0.3.12.2 opts=level:124:0:e242,hold:124:0,survive:124:0,toward:124:0
20093 play=hold v=dies under=1 mat=18 land=108 dies=108 w3=-1 sooner=toward:110:k5.value mgs=0.2.0.12,0.3.0.2,0.2.0.12 opts=hold:108:0,toward:110:0,survive~:108:0
20106 play=survive v=dies under=1 mat=18 land=95 dies=95 w3=0 sooner=survive:103:k5.value mgs=0.2.0.12,0.2.0.4,0.2.0.12,0.3.0.2 opts=survive~:97:0,survive~:103:0,hold:95:0,toward:95:0
20134 play=setup v=dies under=1 mat=15 land=67 dies=67 w3=0 mgs=0.2.0.12,0.2.0.12,0.2.0.4,0.2.0.2,0.2.0.12,0.2.0.12,0.2.0.12,0.2.0.2 opts=setup~:67:0:e91,setup~:67:0:e84,survive~:75:0,setup:71:0,carry*~:69:0,survive~:69:0,hold:67:0,toward:67:0
20158 play=carry v=dies under=1 mat=15 land=43 dies=43 w3=0 mgs=0.2.0.12,0.2.0.2,0.2.0.12,0.2.0.2,0.2.0.12,0.2.0.12,0.2.0.12 opts=carry*~:43:0:e67,level:44:0,hold:43:0,toward:43:0,setup~:43:0,survive~:43:0,survive~:43:0
20178 play=toward v=dies under=1 mat=15 land=23 dies=23 w3=0 mgs=0.2.0.4,0.2.0.4,0.2.0.12 opts=toward~:49:0,survive~:49:0,hold:23:0
20195 play=toward v=dies under=1 mat=15 land=6 dies=6 w3=0 mgs=0.2.0.4,0.2.0.4,0.2.0.4,0.2.0.2,0.2.0.2,0.2.0.2 opts=toward~:32:0,carry*~:32:0,survive~:32:0,hold:6:0,level:6:0,level:6:0
20212 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4,0.2.0.4 opts=hold:15:0,level:15:0
20213 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.12,0.2.0.4 opts=hold:14:0,level:14:0
20215 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4,0.2.0.4 opts=hold:12:0,level:12:0
20216 play=level v=dies under=1 mat=15 land=0 dies=1 w3=0 mgs=0.2.0.4,0.2.0.4 opts=level:12:0,hold:11:0
20217 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:10:0
20218 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:9:0
20219 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:8:0
20220 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:7:0
20221 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:6:0
20222 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:5:0
20223 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:4:0
20224 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:3:0
20225 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4,0.2.0.4 opts=hold:2:0,level:2:0
20226 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4,0.2.0.4 opts=hold:1:0,level:1:0
```

## combo_storm-2 round 2, lost at 4646

```
4250 play=clear v=dies under=0 mat=38 land=56 dies=57 w3=0 mgs=0.6.12.12,0.5.12.3,0.5.12.3,0.5.12.3,0.5.12.3,0.5.12.3 opts=clear:268:0,entry:191:0:b1,carry_wait*:203:0:b1,carry:203:0:b1,hold:134:0,entry:134:0
4277 play=clear v=dies under=0 mat=38 land=107 dies=107 w3=0 mgs=0.5.12.3,0.5.12.3,0.5.12.12,0.5.12.12,0.5.12.12 opts=clear:141:0:b2,clear:141:0:b2,hold:107:0,level:107:0,survive:107:0
4290 play=hold v=dies under=0 mat=38 land=128 dies=128 w3=-1 sooner=survive:287:k2.margin mgs=0.5.12.12,0.5.12.12,0.5.12.12,0.3.12.2 opts=hold:128:0,level:128:0,survive:128:0,survive~:287:0:b2
4306 play=hold v=dies under=0 mat=35 land=112 dies=112 w3=-1 sooner=survive:304:k2.margin mgs=0.5.12.12,0.5.12.12,0.3.12.2 opts=hold:112:0,survive:112:0,survive~:304:0:b3
4322 play=survive v=dies under=0 mat=35 land=96 dies=96 w3=2/w mgs=0.2.12.2,1.5.12.12,0.5.12.12,0.5.12.12 opts=survive~:299:0:b3,level:111:0,level:96:0:e172,hold:96:0
4349 play=carry v=dies under=0 mat=31 land=120 dies=120 w3=1/w mgs=0.2.12.2,0.3.12.4,0.4.12.12,0.4.12.12,0.2.12.4,0.3.12.2 opts=carry*~:272:0:e359:b3,survive~:186:0:b3,level:120:0:e168,hold:120:0,survive~:272:0:b3,carry~:168:0:b2
4373 play=carry v=dies under=0 mat=31 land=96 dies=144 w3=1/w mgs=0.2.12.2,0.2.12.4,0.3.12.2,0.3.12.2 opts=carry*~:248:0:e335:b1,survive~:313:0:b1,hold:144:0,clear:144:0
4407 play=carry v=dies under=0 mat=25 land=110 dies=110 w3=1/w mgs=0.2.12.2,0.3.12.12,0.3.12.12,0.3.12.12,0.2.12.4 opts=carry*~:214:0:einf:b3,level:110:0:e186,hold:110:0,survive:110:0,survive~:234:0:b3
4444 play=hold v=dies under=0 mat=25 land=110 dies=177 w3=-1 sooner=survive:253:k4.list mgs=0.2.12.2,0.2.12.8 opts=hold:177:0,survive~:253:0:b2
4457 play=clear v=dies under=0 mat=22 land=97 dies=164 w3=0 sooner=clear:164:k2.margin mgs=5.3.12.12,0.2.12.2,0.2.12.2,0.2.12.8 opts=clear:185:0,clear:164:0:e260,hold:164:0,survive~:240:0:b2
4482 play=clear v=dies under=0 mat=22 land=72 dies=139 w3=0 sooner=survive:215:k4.list mgs=0.2.12.2,0.2.12.2,0.2.12.8,0.2.12.8 opts=clear:139:0:e153,hold:139:0,survive~:215:0:b2,survive~:215:0:b2
4493 play=hold v=dies under=0 mat=19 land=115 dies=128 w3=-1 sooner=survive:204:k4.list mgs=0.2.12.2,0.2.12.4,0.2.12.4,0.2.12.8 opts=hold:128:0,survive:139:0,level:139:0,survive~:204:0:b2
4506 play=hold v=dies under=0 mat=19 land=102 dies=115 w3=-1 sooner=survive:126:k5.value mgs=0.2.12.2,0.2.12.4,0.2.12.4 opts=hold:115:0,survive:126:0,level:126:0
4519 play=hold v=dies under=0 mat=19 land=89 dies=102 w3=-1 sooner=survive:113:k5.value mgs=0.2.12.2,0.2.12.4,0.2.12.4 opts=hold:102:0,survive:113:0,level:113:0
4532 play=level v=dies under=0 mat=19 land=76 dies=89 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.2 opts=level:100:0,survive:100:0,hold:89:0
4547 play=survive v=dies under=0 mat=15 land=61 dies=85 w3=0 mgs=0.2.12.4,0.2.12.4 opts=survive:98:0,hold:85:0
4570 play=toward v=dies under=1 mat=15 land=38 dies=65 w3=0 mgs=4.2.12.4,4.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=toward:77:0,setup:67:0,carry*:75:0,setup:69:0,survive:69:0,hold:65:0
4582 play=toward v=dies under=1 mat=15 land=26 dies=55 w3=0 mgs=4.2.12.4,4.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=toward:65:0,carry*:65:0,survive:58:0,hold:55:0,setup:55:0
4594 play=toward v=dies under=1 mat=15 land=14 dies=46 w3=0 mgs=4.2.12.4,4.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=toward:53:0,carry*:53:0,survive:50:0,hold:46:0,setup:46:0
4606 play=toward v=dies under=1 mat=15 land=2 dies=38 w3=0 mgs=4.2.12.4,4.2.12.4,4.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=toward:41:0,carry*:41:0,level:38:0,setup:40:0,survive:40:0,hold:38:0
4619 play=setup v=dies under=1 mat=15 land=0 dies=25 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=setup:28:0,toward:28:0,carry*:28:0,hold:25:0,level:25:0
4632 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4 opts=hold:15:0,toward:15:0,level:15:0
4633 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.12,0.2.12.4 opts=hold:14:0,level:14:0
4635 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:12:0,level:12:0
4636 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:11:0,level:11:0
4637 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:10:0,level:10:0
4638 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:9:0,level:9:0
4639 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:8:0,level:8:0
4640 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:7:0,level:7:0
4641 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:6:0,level:6:0
4642 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:5:0,level:5:0
4643 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:4:0,level:4:0
4644 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:3:0,level:3:0
4645 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:2:0,level:2:0
4646 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:1:0,level:1:0
```

## combo_storm-2 round 3, lost at 11053

```
10658 play=clear v=dies under=0 mat=23 land=102 dies=188 w3=0 mgs=0.7.12.3,0.2.12.6 opts=clear:171:0:n:e445,hold:188:0:n
10669 play=survive v=dies under=0 mat=23 land=91 dies=160 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2 opts=survive~:209:0:n:e299:b7,hold:160:0:n,clear:160:0:n:e213
10693 play=clear v=dies under=0 mat=23 land=67 dies=136 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2 opts=clear:136:0:e467,carry*~:185:0:n:e275:b7,survive~:187:0:b7,hold:136:0
10704 play=clear v=dies under=0 mat=20 land=56 dies=125 w3=0 sooner=clear:174:k4.list mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2 opts=clear:125:0:e452,clear~:174:0:e495:b7,hold:125:0,survive~:174:0:b7,carry~:174:0:b7
10716 play=clear v=dies under=0 mat=20 land=98 dies=113 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2 opts=clear~:162:0:e485:b7,hold:113:0:n,clear~:162:0:b7,survive~:162:0:b7,carry~:162:0:b7
10733 play=clear v=dies under=0 mat=20 land=81 dies=145 w3=0 mgs=0.2.12.2,0.2.12.2 opts=clear:145:0:einf,hold:145:0
10747 play=clear v=dies under=0 mat=20 land=67 dies=131 w3=0 mgs=0.2.12.2,8.3.12.12,0.2.12.2,0.2.12.2 opts=clear:131:0:e388,clear:178:0,hold:131:0,survive:131:0
10760 play=survive v=dies under=0 mat=17 land=108 dies=118 w3=0 mgs=0.2.12.2,0.2.12.4,0.2.12.2 opts=survive:215:4,level:135:0:n:e212,hold:118:0
10786 play=carry v=dies under=0 mat=17 land=82 dies=92 w3=0 mgs=0.2.12.2,0.3.12.4,0.2.12.4,0.2.12.2 opts=carry*:189:4:e367,survive:226:8,level:109:0:n:e186,hold:92:0
10813 play=break_line v=dies under=0 mat=14 land=55 dies=82 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.3.12.4,0.2.12.4 opts=break_line:162:4:e340,ready:162:4:n0:e340,carry*:162:4:e340,survive:199:8,hold:82:0:n
10832 play=setup v=dies under=1 mat=14 land=108 dies=143 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.6 opts=setup:143:0:e328,hold:143:0,survive:154:0
10860 play=hold v=dies under=1 mat=14 land=80 dies=115 w3=-1 sooner=survive:126:k5.value mgs=0.2.12.2,0.2.12.4 opts=hold:115:0,survive:126:0
10873 play=hold v=dies under=1 mat=14 land=67 dies=102 w3=-1 mgs=0.2.12.2,0.2.12.2 opts=hold:102:0,survive:102:0
10886 play=survive v=dies under=1 mat=11 land=54 dies=89 w3=0 mgs=0.2.12.4,0.2.12.2,0.2.12.2 opts=survive:105:0,hold:89:0,level:89:0
10924 play=hold v=dies under=0 mat=15 land=83 dies=99 w3=-1 sooner=level:110:k5.value mgs=0.2.12.2,0.2.12.4,0.2.12.4 opts=hold:99:0,level:110:0,survive:110:0
10925 play=toward v=dies under=1 mat=15 land=15 dies=66 w3=1/w mgs=3.2.12.4,3.2.12.4,3.2.12.4,3.2.12.4,0.2.12.4 opts=toward:254:0,level:71:0,toward:69:0,toward:69:0,hold:66:0
10937 play=survive v=dies under=0 mat=15 land=70 dies=86 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.2 opts=survive:105:0,level:97:0,hold:86:0
10950 play=carry v=dies under=0 mat=15 land=57 dies=73 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.2 opts=carry*:92:0,survive:92:0,hold:73:0
10957 play=toward v=dies under=1 mat=15 land=0 dies=35 w3=1/w mgs=0.2.12.6,0.1.12.6,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.6 opts=toward:222:0,survive~:217:0:b1,survive:38:0,toward:37:0,toward:37:0,hold:35:0,survive:35:0
10964 play=setup v=dies under=1 mat=12 land=43 dies=78 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=setup:81:0:e161,setup:81:0,hold:78:0,level:78:0
10972 play=toward v=dies under=1 mat=15 land=0 dies=22 w3=1/w mgs=1.2.12.6,0.1.12.6,0.2.12.8,1.2.12.6,1.2.12.6,1.2.12.6,1.2.12.6,1.2.12.6 opts=toward:207:0,survive~:207:0:b1,survive~:106:0,level:27:0,survive:23:0,survive:22:0,survive:22:0,survive:22:0
10982 play=level v=dies under=1 mat=12 land=25 dies=63 w3=0 mgs=6.2.12.4,6.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=level:77:0,clear:67:0,setup:67:0,level:65:0,hold:63:0
10991 play=survive v=dies under=1 mat=12 land=16 dies=47 w3=0 mgs=3.2.12.4,3.2.12.4,3.2.12.4,3.2.12.4,0.2.12.4,0.2.12.4 opts=survive:49:0,level:49:0,survive:49:0,clear:49:0,setup:48:0,hold:47:0
10996 play=level v=dies under=1 mat=12 land=11 dies=53 w3=0 mgs=6.2.12.4,6.2.12.4,6.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=level:63:0,carry*:63:0,toward:61:0,level:59:0,setup:54:0,setup:54:0,hold:53:0
11010 play=level v=dies under=1 mat=12 land=0 dies=39 w3=0 mgs=0.2.12.4,3.2.12.4,3.2.12.4,3.2.12.4,0.2.12.2,0.2.12.4,0.2.12.4,0.2.12.4 opts=level:44:0:e121,clear:50:0,level:49:0,carry*:49:0,level:48:0,setup:41:0,setup:41:0,hold:39:0
11037 play=level v=dies under=1 mat=12 land=0 dies=1 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=level:20:0,level:20:0,hold:17:0,toward:17:0,survive:17:0
11040 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.12,0.2.12.4,0.2.12.4 opts=hold:14:0,toward:14:0,survive:14:0
11042 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4 opts=hold:12:0,toward:12:0,survive:12:0
11043 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4 opts=hold:11:0,toward:11:0,survive:11:0
11044 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=hold:10:0,toward:10:0,carry*:10:0,survive:10:0
11045 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4,0.2.12.4 opts=hold:9:0,survive:9:0
11046 play=level v=dies under=1 mat=12 land=0 dies=1 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=level:12:0,level:12:0,hold:8:0,survive:8:0
11047 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:7:0
11048 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:6:0
11049 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:5:0
11050 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:4:0
11051 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:3:0
11052 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:2:0
11053 play=hold v=dies under=1 mat=12 land=0 dies=1 w3=-1 mgs=0.2.12.4 opts=hold:1:0
```

## combo_storm-3 round 2, lost at 9403

```
9023 play=entry v=dies under=0 mat=37 land=52 dies=115 w3=0 mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,4.6.12.12,0.3.12.4,0.3.12.4 opts=entry:333:4:b1,break_line:302:4,entry:322:4,break_line:310:4,carry_wait*:318:4,entry:333:1:b2,survive~:252:0:n:e325:b1,entry~:244:0:b1
9043 play=carry_wait v=dies under=0 mat=34 land=95 dies=95 w3=0 mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.5.12.12,0.5.12.12 opts=carry_wait*:313:4:b2,carry:313:4:b2,entry:302:4:b1,break_line:290:4:b1,break_line:186:1:b1,hold:95:0,level:95:0
9058 play=carry_wait v=dies under=0 mat=34 land=80 dies=80 w3=0 mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.3.12.4,0.4.12.2,0.5.12.12,0.5.12.12 opts=carry_wait*:298:4:b2,carry:298:4:b2,entry:287:4:b1,break_line:275:4:b1,carry~:209:0:b2,break_line:171:1:b1,hold:80:0,level:80:0
9074 play=carry v=dies under=0 mat=34 land=64 dies=64 w3=0 sooner=extend:309:k5.value mgs=0.4.12.2,0.3.12.2,0.3.12.2,0.4.12.2,0.5.12.12 opts=carry:282:4:b2,extend:309:4:b2,extend:309:4:b2,carry:192:0,hold:64:0
9090 play=carry v=dies under=1 mat=31 land=48 dies=48 w3=0 mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,4.5.12.3,0.4.12.2,0.4.12.2 opts=carry*:266:4:b2,entry:254:4:b2,entry:254:4:b2,extend:251:4:b2,extend:251:4:b2,break_line:121:1,entry:183:4:b1,entry:183:4:b1
9105 play=carry v=dies under=1 mat=31 land=33 dies=33 w3=0 sooner=extend:269:k5.value mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.3.12.2,1.5.12.4,0.4.12.2,1.5.12.4 opts=carry*:251:4:b2,entry:247:4:b2,entry:247:4:b2,extend:251:4:b2,extend:269:4:b2,break_line:109:1,nearest:216:4:b1,level:33:0
9121 play=entry v=dies under=1 mat=31 land=17 dies=17 w3=0 sooner=extend:257:k5.value mgs=0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.4.12.2,0.3.12.2,0.3.12.2 opts=entry:235:4:b2,entry:235:4:b2,carry*:235:4:b2,entry:227:4:b1,nearest:220:4:b1,break_search:239:4:b2,extend:257:4:b2,extend:253:4:b2
9137 play=break_line v=dies under=1 mat=31 land=116 dies=117 w3=0 sooner=survive:237:k2.margin mgs=0.5.12.6,0.4.12.2,0.4.12.2,0.4.12.2,0.3.12.2 opts=break_line:219:1,hold:219:0,extend:219:0,extend:219:0,survive~:237:0:b1
9158 play=survive v=dies under=1 mat=31 land=95 dies=96 w3=0 mgs=0.3.12.4,0.4.12.2,0.4.12.2,0.4.12.2 opts=survive~:216:0:b1,hold:198:0,extend:198:0,extend:198:0
9180 play=break_search v=dies under=1 mat=31 land=73 dies=74 w3=0 mgs=0.3.12.2,0.5.12.4,0.3.12.6,0.5.12.4,0.4.12.2,0.4.12.2,0.4.12.2,0.3.12.2 opts=break_search~:270:0:b1,break_line:224:1,clear:151:0,level:151:0,hold:176:0,extend:176:0,extend:176:0,entry:223:0
9207 play=break_line v=dies under=1 mat=25 land=100 dies=100 w3=0 sooner=break_search:243:k2.margin mgs=1.4.12.6,1.4.12.6,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.2 opts=break_line:172:1,level:103:0,setup:100:0:e242,setup:100:0:e173,level:100:0:e148,hold:100:0,survive:100:0,entry:242:4:b1
9229 play=level v=dies under=1 mat=25 land=78 dies=78 w3=0 mgs=0.3.12.12,0.3.12.12,0.3.12.12 opts=level:78:0:e126,hold:78:0,survive:78:0
9247 play=break_search v=dies under=1 mat=25 land=60 dies=60 w3=0 mgs=2.4.12.8,2.4.12.8,2.4.12.8,2.4.12.8,2.4.12.8,0.3.12.12 opts=break_search:137:0,break_search:137:0,level:78:0,break_search:60:0,break_search:60:0,hold:60:0
9274 play=carry v=dies under=1 mat=22 land=33 dies=33 w3=0 mgs=0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.12,0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.6 opts=carry*:110:4,break_line:110:1,break_search:38:0,hold:33:0,setup:33:0,level:33:0,level:33:0,level:33:0
9297 play=break_search v=dies under=1 mat=22 land=10 dies=10 w3=0 mgs=0.3.12.4,0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.6,0.3.12.6 opts=break_search:107:4,carry*:87:4,break_line:87:1,survive:87:0,survive:87:0,hold:10:0,survive:10:0,level:10:0
9313 play=carry v=dies under=1 mat=22 land=66 dies=67 w3=0 mgs=0.3.12.4,0.3.12.6,0.3.12.6 opts=carry*:91:0,hold:71:0,survive:71:0
9352 play=carry v=dies under=1 mat=18 land=27 dies=28 w3=0 mgs=0.3.12.4,0.3.12.4,0.3.12.2,0.3.12.2 opts=carry*:52:0,survive:52:0,hold:32:0,level:32:0
9370 play=hold v=dies under=1 mat=18 land=9 dies=10 w3=-1 mgs=0.3.0.4 opts=hold:34:0
9383 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.0.4 opts=hold:21:0
9390 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.0.12 opts=hold:14:0
9391 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:13:0
9392 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:12:0
9393 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:11:0
9394 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.0.4 opts=hold:10:0
9395 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:9:0
9396 play=level v=dies under=1 mat=23 land=0 dies=1 w3=0 mgs=0.3.12.4,0.3.12.4,0.3.12.4 opts=level:12:0,level:12:0,hold:8:0
9397 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:7:0
9398 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:6:0
9399 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:5:0
9400 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:4:0
9401 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.12.4 opts=hold:3:0
9402 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.0.4 opts=hold:2:0
9403 play=hold v=dies under=1 mat=23 land=0 dies=1 w3=-1 mgs=0.3.0.4 opts=hold:1:0
```

## combo_storm-5 round 2, lost at 1891

```
1492 play=carry v=dies under=1 mat=16 land=73 dies=73 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.3.12.2 opts=carry*:271:4:b1,entry:259:4:b1,entry:259:4:b1,nearest:259:4:b1,entry:259:4:b1,entry:259:4:b1,nearest:259:4:b1,entry:169:8:e198
1504 play=entry v=dies under=1 mat=16 land=61 dies=61 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.3.12.2 opts=entry:259:4:b1,entry:259:4:b1,nearest:259:4:b1,carry*:259:4:b1,entry:259:4:b1,entry:259:4:b1,nearest:259:4:b1,break_search:157:8:e176
1528 play=carry v=dies under=1 mat=16 land=37 dies=37 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.3.12.2 opts=carry*:235:4:b1,entry:228:4:b1,entry:228:4:b1,nearest:228:4:b1,entry:228:4:b1,entry:228:4:b1,nearest:228:4:b1,break_search:133:8:e152
1551 play=entry v=dies under=1 mat=16 land=14 dies=14 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=entry:212:4:b1,entry:212:4:b1,nearest:212:4:b1,carry*:212:4:b1,break_line:212:4:b1,entry:212:4:b1,entry:212:4:b1,nearest:212:4:b1
1567 play=hold v=dies under=1 mat=16 land=46 dies=47 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.10,0.1.12.4 opts=hold:196:0,extend:171:0:e195,extend:171:0:e195,toward:196:0,survive:172:0:e195
1580 play=hold v=dies under=1 mat=16 land=33 dies=34 w3=-1 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.10,0.1.12.4 opts=hold:183:0,extend:158:0:e182,extend:158:0:e182,toward:158:0,survive:159:0:e182
1593 play=hold v=dies under=1 mat=16 land=20 dies=21 w3=-1 sooner=break_search:192:k5.value mgs=0.2.12.4,0.2.12.8,0.2.12.12,0.2.12.10 opts=hold:170:0,survive:170:0,break_search:192:0,level:20:0
1606 play=hold v=dies under=1 mat=13 land=7 dies=8 w3=-1 sooner=break_search:174:k5.value mgs=0.2.12.4,0.2.12.4,0.2.12.6,0.2.12.4,0.2.12.12 opts=hold:157:0,setup:157:0,survive:157:0,setup:157:0,break_search:174:0
1621 play=hold v=dies under=1 mat=13 land=142 dies=142 w3=-1 mgs=0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12 opts=hold:142:0,level:142:0,survive:142:0,toward:142:0
1635 play=hold v=dies under=1 mat=13 land=128 dies=128 w3=-1 mgs=0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12 opts=hold:128:0,level:128:0,survive:128:0,toward:128:0
1648 play=hold v=dies under=1 mat=13 land=115 dies=115 w3=-1 mgs=0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12 opts=hold:115:0,level:115:0,survive:115:0,toward:115:0
1661 play=hold v=dies under=1 mat=10 land=102 dies=102 w3=-1 sooner=setup:120:k5.value mgs=0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.4,0.2.12.12 opts=hold:102:0,level:102:0,setup:102:0,level:102:0,survive:102:0,setup:120:0,toward:102:0
1675 play=toward v=dies under=1 mat=10 land=88 dies=88 w3=0 mgs=0.2.12.8,0.2.12.4,0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12,0.2.12.12 opts=toward:119:0,survive:116:0,hold:88:0,level:88:0,setup:88:0,setup:88:0,setup:88:0,setup:88:0
1697 play=survive v=dies under=1 mat=14 land=66 dies=66 w3=0 mgs=0.2.12.8,0.2.12.8,0.2.12.12,0.2.12.4,0.2.12.12,0.2.12.12,0.2.12.4,0.2.12.12 opts=survive:105:0,carry*:97:0,setup:66:0:e93,level:75:0,hold:66:0,level:66:0,toward:66:0,setup:66:0
1721 play=break_search v=dies under=1 mat=14 land=42 dies=42 w3=0 sooner=setup:42:k4.list mgs=0.2.12.2,0.2.12.12,0.2.12.8,0.2.12.8,0.2.12.8,0.2.12.8,0.2.12.12,0.2.12.8 opts=break_search:164:4:e187,setup:42:0:e194,level:87:0,carry*:81:0,survive:75:0,survive:75:0,level:44:0:e70,level:47:0
1742 play=break_search v=dies under=1 mat=14 land=21 dies=21 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.12 opts=break_search:143:4:e166,carry*:143:4:e166,survive:143:4,level:76:0,level:46:0,level:36:0,level:26:0,hold:21:0
1768 play=break_search v=dies under=1 mat=14 land=0 dies=1 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.6,0.2.12.6,0.2.12.8,0.2.12.6,0.2.12.6 opts=break_search:117:4:e140,carry*:117:4:e140,survive:117:4,break_line:97:1,level:34:0,level:32:0,hold:19:0:n,level:19:0
1794 play=carry v=dies under=1 mat=14 land=65 dies=66 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.6,0.2.12.6 opts=carry*:91:0:e114,survive:111:0,toward:99:0,toward:100:0,toward:104:0,level:75:0,hold:71:0
1815 play=toward v=dies under=1 mat=14 land=44 dies=45 w3=0 sooner=survive:96:k2.margin mgs=1.2.12.8,1.2.12.8,0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2 opts=toward:78:0,level:77:0,survive:96:0,survive:96:0,survive:88:0,hold:70:0
1829 play=toward v=dies under=1 mat=13 land=30 dies=31 w3=0 mgs=1.2.12.6,1.2.12.6,1.2.12.6,1.2.12.6,1.2.12.6,0.2.12.2 opts=toward:64:0,carry*:64:0,survive:62:0,survive:56:0,level:56:0,hold:56:0
1843 play=level v=dies under=1 mat=10 land=16 dies=17 w3=0 mgs=1.1.12.4,1.1.12.4,1.1.12.4,0.2.12.4,0.2.12.2,0.2.12.4 opts=level:58:0,toward:50:0,carry*:50:0,hold:46:0,survive:46:0,setup:46:0
1874 play=carry v=dies under=1 mat=15 land=0 dies=1 w3=0 mgs=0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4,0.2.12.4 opts=carry*:27:0,level:24:0,level:24:0,hold:18:0,toward:18:0,setup:18:0
1878 play=level v=dies under=1 mat=15 land=0 dies=1 w3=0 mgs=0.2.0.4,0.2.0.4,0.2.0.12 opts=level:20:0,level:20:0,hold:14:0
1880 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:12:0
1881 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:11:0
1882 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:10:0
1883 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:9:0
1884 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:8:0
1885 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:7:0
1886 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:6:0
1887 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4,0.2.0.4,0.2.0.4,0.2.0.4 opts=hold:5:0,carry*:5:0,level:5:0,level:5:0
1888 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:4:0
1889 play=carry v=dies under=1 mat=15 land=0 dies=1 w3=0 mgs=0.2.0.4,0.2.0.4,0.2.0.4,0.2.0.4 opts=carry*:12:0,hold:3:0,level:3:0,level:3:0
1890 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:2:0
1891 play=hold v=dies under=1 mat=15 land=0 dies=1 w3=-1 mgs=0.2.0.4 opts=hold:1:0
```

## combo_storm-5 round 3, lost at 16631

```
16244 play=level v=dies under=0 mat=33 land=67 dies=70 w3=0 mgs=0.5.12.4,0.5.12.6 opts=level:74:0:e312,hold:70:0
16270 play=survive v=dies under=0 mat=30 land=97 dies=101 w3=1/w mgs=0.1.12.2,0.4.12.4,0.4.12.4 opts=survive~:342:0:b4,hold:101:0,survive:116:0
16293 play=carry v=dies under=0 mat=27 land=74 dies=78 w3=1/w mgs=0.1.12.2,0.1.12.6,6.4.12.12,0.4.12.4,0.4.12.4 opts=carry*~:319:0:e341:b4,survive~:331:0:b4,survive:83:0,carry:93:0,hold:78:0
16320 play=carry v=dies under=0 mat=24 land=95 dies=228 w3=0 mgs=0.1.12.2,0.1.12.6,0.2.12.2,0.2.12.6 opts=carry*~:292:0:e314:b3,survive~:304:0:b3,hold:228:0,clear:239:0
16357 play=carry v=dies under=0 mat=24 land=58 dies=191 w3=0 mgs=0.1.12.2,0.1.12.8,0.2.12.2,0.2.12.2 opts=carry*~:255:0:e277:b3,survive~:267:0:b3,hold:191:0,clear:191:0
16374 play=clear v=dies under=0 mat=21 land=95 dies=238 w3=0 mgs=0.1.12.2,0.1.12.2,0.1.12.8 opts=clear:238:0:e260,hold:238:0,survive:250:0
16403 play=clear v=dies under=0 mat=21 land=66 dies=209 w3=0 mgs=0.1.12.2,0.1.12.2,0.1.12.2 opts=clear:209:0:e227,hold:209:0,survive:209:0
16420 play=hold v=dies under=0 mat=18 land=109 dies=192 w3=-1 sooner=survive:204:k5.value mgs=0.1.12.2,0.1.12.6,0.1.12.2 opts=hold:192:0,survive:204:0,clear:192:0
16433 play=clear v=dies under=0 mat=18 land=96 dies=179 w3=0 mgs=0.1.12.2,0.1.12.2,0.1.12.6 opts=clear:179:0:e197,hold:179:0,survive:191:0
16450 play=clear v=dies under=0 mat=18 land=79 dies=162 w3=0 sooner=survive:187:k5.value mgs=0.1.12.2,0.1.12.2,0.1.12.6 opts=clear:162:0:e176,hold:162:0,survive:187:0
16465 play=clear v=dies under=0 mat=18 land=64 dies=147 w3=0 mgs=0.1.12.2,0.1.12.2,0.1.12.6 opts=clear:147:0:e165,hold:147:0,survive:159:0
16480 play=hold v=dies under=0 mat=14 land=103 dies=132 w3=-1 sooner=survive:144:k5.value mgs=0.1.12.2,0.1.12.6,0.1.12.6 opts=hold:132:0,survive:144:0,level:144:0
16493 play=hold v=dies under=0 mat=14 land=90 dies=119 w3=-1 sooner=survive:131:k5.value mgs=0.1.12.2,0.1.12.6,0.1.12.6 opts=hold:119:0,survive:131:0,level:131:0
16506 play=hold v=dies under=0 mat=14 land=77 dies=106 w3=-1 sooner=survive:118:k5.value mgs=0.1.12.2,0.1.12.6,0.1.12.6 opts=hold:106:0,survive:118:0,level:118:0
16519 play=survive v=dies under=0 mat=14 land=64 dies=93 w3=0 mgs=0.1.12.6,0.1.12.2 opts=survive:105:0,hold:93:0
16534 play=survive v=dies under=1 mat=11 land=49 dies=90 w3=0 sooner=toward:101:k5.value mgs=0.1.12.6,2.1.12.0,2.1.12.0,2.1.12.0,0.1.12.6,0.1.12.6,0.1.12.6 opts=survive:97:0,toward:97:0,toward:101:0,toward:96:0,setup:91:0,hold:90:0,carry*:90:0
16553 play=toward v=dies under=1 mat=11 land=30 dies=73 w3=0 sooner=survive:81:k2.margin mgs=7.1.12.4,7.1.12.4,7.1.12.4,0.1.12.6,0.1.12.6,0.1.12.6,0.1.12.6 opts=toward:76:0,toward:75:0,toward:74:0,survive:81:0,carry*:78:0,hold:73:0,setup:73:0
16579 play=level v=dies under=1 mat=11 land=4 dies=47 w3=0 mgs=3.1.12.6,3.1.12.6,3.1.12.6,0.1.12.6,0.1.12.6 opts=level:56:0,toward:50:0,carry*:50:0,setup:49:0,hold:47:0
16603 play=level v=dies under=1 mat=11 land=0 dies=27 w3=0 mgs=2.1.12.6,2.1.12.6,2.1.12.6,2.1.12.6,0.1.12.6 opts=level:32:0,carry*:32:0,toward:27:0,setup:27:0,hold:27:0
16617 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.12,0.1.12.6 opts=hold:14:0,level:14:0
16618 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:13:0,level:13:0
16619 play=carry v=dies under=1 mat=11 land=0 dies=1 w3=0 mgs=0.1.12.6,0.1.12.6 opts=carry*:16:0,hold:12:0
16620 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:11:0,level:11:0
16621 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:10:0,level:10:0
16622 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:9:0,level:9:0
16623 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:8:0,level:8:0
16624 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:7:0,level:7:0
16625 play=level v=dies under=1 mat=11 land=0 dies=1 w3=0 mgs=0.1.12.6,0.1.12.6 opts=level:7:0,hold:6:0
16626 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6 opts=hold:6:0
16627 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6 opts=hold:5:0
16628 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6 opts=hold:4:0
16629 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6 opts=hold:3:0
16630 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:1:0,level:1:0
16631 play=hold v=dies under=1 mat=11 land=0 dies=1 w3=-1 mgs=0.1.0.6 opts=hold:1:0
```

## combo_storm-6 round 2, lost at 18333

```
17934 play=carry_wait v=dies under=0 mat=37 land=83 dies=137 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.4,0.7.12.2,0.7.12.2,4.6.12.12,4.6.12.12,0.5.12.6 opts=carry_wait*:391:20:b1,carry:375:20:b1,entry:370:20:b1,entry:360:20:b1,break_line:360:20:b1,entry:145:5:b1,break_line:145:5:b1,clear:137:0
17950 play=carry_wait v=dies under=0 mat=37 land=67 dies=121 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.4,4.6.12.12,4.6.12.12,0.5.12.6 opts=carry_wait*:375:20:b1,carry:359:20:b1,entry:344:20:b1,break_line:344:20:b1,entry:354:20:b1,entry:129:5:b1,break_line:129:5:b1,clear:121:0
17966 play=carry_wait v=dies under=0 mat=34 land=105 dies=105 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.4,4.5.12.12,0.5.12.12,0.5.12.12,0.4.12.2 opts=carry_wait*:359:20:b1,break_line:328:20:b1,carry:343:20:b1,entry:338:20:b1,break_line:113:5:b1,hold:105:0,level:105:0,carry~:162:0:b6
17981 play=carry_wait v=dies under=0 mat=34 land=90 dies=90 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.4,4.5.12.12,0.4.12.2,0.5.12.12,0.5.12.12 opts=carry_wait*:344:20:b1,break_line:313:20:b1,carry:328:20:b1,entry:337:20:b1,break_line:98:5:b1,carry~:156:0:b1,hold:90:0,level:90:0
17996 play=carry_wait v=dies under=0 mat=34 land=75 dies=75 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.5.12.4,0.4.12.2,4.5.12.12,0.5.12.12,0.5.12.12 opts=carry_wait*:329:20:b1,break_line:300:20:b1,carry:313:20:b1,carry:202:8:b1,entry~:178:0:b1,break_line:85:5:b1,hold:75:0,level:75:0
18011 play=carry_wait v=dies under=0 mat=34 land=60 dies=60 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.4.12.2,0.5.12.12,0.5.12.12 opts=carry_wait*:314:20:b1,break_line:287:20:b1,carry:298:20:b1,carry:278:20:b1,entry~:178:0:b1,hold:60:0,level:60:0
18026 play=carry_wait v=dies under=1 mat=31 land=45 dies=45 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2 opts=carry_wait*:308:20:b1,entry:287:20:b1,entry:287:20:b1,entry:287:20:b1,entry:287:20:b1,nearest:287:20:b1,break_line:287:20:b1,carry:292:20:b1
18047 play=entry v=dies under=1 mat=31 land=24 dies=24 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.3,0.5.12.2 opts=entry:287:20:b1,entry:287:20:b1,entry:287:20:b1,entry:287:20:b1,nearest:287:20:b1,carry*:287:20:b1,break_search:199:16:e222,break_line:219:5
18066 play=carry_wait v=dies under=1 mat=31 land=5 dies=6 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2 opts=carry_wait*:268:20:b1,carry:268:20:b1,entry:264:20:b1,entry:264:20:b1,entry:264:20:b1,entry:264:20:b1,nearest:264:20:b1,break_line:264:20:b1
18080 play=carry v=dies under=1 mat=31 land=0 dies=1 w3=0 mgs=0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2,0.7.12.2 opts=carry*:254:20:b1,entry:252:20:b1,entry:252:20:b1,entry:252:20:b1,entry:252:20:b1,nearest:252:20:b1,break_search:252:20:b1,survive:252:20:b1
18095 play=hold v=dies under=1 mat=31 land=239 dies=239 w3=-1 mgs=0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12 opts=hold:239:0,survive:239:0,level:239:0,toward:239:0
18108 play=hold v=dies under=1 mat=31 land=226 dies=226 w3=-1 mgs=0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12 opts=hold:226:0,survive:226:0,level:226:0,toward:226:0
18123 play=hold v=dies under=1 mat=31 land=211 dies=211 w3=-1 mgs=0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12 opts=hold:211:0,survive:211:0,level:211:0,toward:211:0,toward:211:0
18139 play=hold v=dies under=1 mat=31 land=195 dies=195 w3=-1 mgs=0.7.12.12,0.7.12.12,0.7.12.12,0.4.12.12 opts=hold:195:0,survive:195:0,level:195:0,toward:32:0:e194
18155 play=hold v=dies under=1 mat=31 land=179 dies=179 w3=-1 sooner=level:183:k5.value mgs=0.7.12.12,0.7.12.12,0.5.12.6 opts=hold:179:0,level:179:0,level:183:0
18171 play=toward v=dies under=1 mat=25 land=163 dies=163 w3=2/w mgs=0.6.12.10,0.6.12.4,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12 opts=toward~:268:0:b1,survive~:237:0:b1,hold:163:0,setup:163:0,level:163:0,level:163:0,setup:163:0
18191 play=toward v=dies under=1 mat=25 land=143 dies=143 w3=2/w sooner=survive:262:k2.margin mgs=0.6.12.10,0.6.12.10,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12,0.6.12.2 opts=toward~:248:0:b1,carry*~:248:0:b1,hold:143:0,level:143:0,setup:143:0,level:143:0,setup~:143:0,survive~:262:0:b1
18213 play=level v=dies under=1 mat=25 land=121 dies=121 w3=0 mgs=0.7.12.4,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.2 opts=level~:181:0:b1,hold:121:0,level:121:0,setup:121:0,setup:121:0,convert~:176:0:b1
18243 play=carry v=dies under=1 mat=25 land=91 dies=91 w3=0 sooner=break_search:244:k2.margin mgs=0.6.12.4,0.5.12.4,0.6.12.2,0.7.12.2,0.7.12.12,0.7.12.12,0.7.12.12,0.7.12.12 opts=carry*~:158:0:b3,survive~:197:0:b2,break_search:244:4:b1,convert~:146:0:b1,hold:91:0,level:91:0,setup:91:0,setup:91:0
18257 play=survive v=dies under=1 mat=25 land=77 dies=77 w3=1/w sooner=break_search:243:k2.margin mgs=0.5.12.4,0.6.12.4,0.6.12.4,0.6.12.2,0.7.12.2,0.4.12.0,0.7.12.12,0.7.12.12 opts=survive~:193:0:b1,carry*~:144:0:b3,survive~:144:0:b1,break_search:243:4,convert~:125:0,clear~:158:0,hold:77:0,level:77:0
18298 play=level v=dies under=0 mat=45 land=84 dies=84 w3=0 mgs=0.7.12.12,0.5.12.4,0.5.12.4,3.7.12.12,0.7.12.12 opts=level:84:0:e196,carry*~:152:0:b1,survive~:152:0:b1,level:84:0,hold:84:0
18308 play=clear v=dies under=1 mat=45 land=26 dies=26 w3=0 sooner=survive:199:k4.list mgs=0.7.12.4,0.5.12.4,0.6.12.4,0.7.12.4,0.7.12.12,0.7.12.4,0.7.12.4,0.7.12.12 opts=clear~:180:0,survive~:199:0:b2,carry~:143:0:b1,level:34:0,hold:26:0,carry:26:0,setup:26:0,carry:26:0
18321 play=survive v=dies under=0 mat=45 land=61 dies=61 w3=0 sooner=carry:151:k2.margin mgs=3.7.12.12,0.5.12.8,0.7.12.4,0.7.12.12 opts=survive:120:0,carry~:151:0:b1,level:72:0,hold:61:0
18328 play=hold v=dies under=1 mat=45 land=6 dies=6 w3=-1 mgs=0.7.12.4,0.7.12.4,0.7.12.4 opts=hold:6:0,level:6:0,level:6:0
18329 play=hold v=dies under=1 mat=45 land=5 dies=5 w3=-1 mgs=0.7.12.4,0.7.12.4,0.7.12.4 opts=hold:5:0,level:5:0,level:5:0
18330 play=hold v=dies under=1 mat=45 land=4 dies=4 w3=-1 mgs=0.7.12.4,0.7.12.4,0.7.12.4 opts=hold:4:0,level:4:0,level:4:0
18331 play=hold v=dies under=1 mat=45 land=3 dies=3 w3=-1 mgs=0.7.12.4,0.7.12.4,0.7.12.4 opts=hold:3:0,level:3:0,level:3:0
18332 play=hold v=dies under=1 mat=45 land=1 dies=2 w3=-1 mgs=0.7.0.4,0.7.0.4,0.7.0.4 opts=hold:2:0,level:2:0,level:2:0
18333 play=hold v=dies under=1 mat=45 land=1 dies=1 w3=-1 mgs=0.7.0.4,0.7.0.4,0.7.0.4 opts=hold:1:0,level:1:0,level:1:0
```

## combo_storm-6 round 3, lost at 10891

```
10492 play=clear v=dies under=0 mat=26 land=70 dies=188 w3=0 sooner=carry_wait:550:k4.list mgs=0.2.12.2,0.7.12.6,0.7.12.6,0.1.12.8,6.4.12.12,0.2.12.2,0.3.12.2 opts=clear:188:0:e349,carry_wait*:550:36,carry:550:36,survive~:327:0:b4,carry_wait:218:0,hold:188:0:n,ready:135:0:n0:e215
10517 play=clear v=dies under=0 mat=23 land=98 dies=163 w3=0 mgs=0.2.12.2,0.1.12.8,0.2.12.2,0.1.12.2 opts=clear:163:0:einf,survive~:302:0:b4,hold:163:0,survive~:290:0:b4
10531 play=clear v=dies under=0 mat=23 land=84 dies=149 w3=0 mgs=0.2.12.2,0.2.12.2,0.1.12.2,0.1.12.2,0.1.12.2 opts=clear:149:0:einf,hold:149:0,survive~:276:0:b4,survive~:276:0:b4,survive~:276:0:b4
10545 play=clear v=dies under=0 mat=23 land=70 dies=135 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.1.12.2,0.1.12.2 opts=clear:135:0:e294,survive~:198:0:b3,hold:135:0,survive~:262:0:b4,survive~:262:0:b4
10560 play=clear v=dies under=0 mat=20 land=55 dies=120 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2,0.1.12.2 opts=clear:120:0:e279,survive~:183:0:b3,survive~:183:0:b3,hold:120:0,survive~:247:0:b4
10575 play=level v=dies under=0 mat=20 land=94 dies=105 w3=0 mgs=0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2,0.2.12.2,0.1.12.2 opts=level:115:0:einf,ready~:115:0:n0:einf,survive~:168:0:b3,survive~:168:0:b3,hold:105:0:n,survive~:232:0:b4
10594 play=survive v=dies under=0 mat=20 land=75 dies=96 w3=0 sooner=survive:225:k2.margin mgs=0.2.12.4,0.1.12.6,0.1.12.6,0.2.12.2,0.2.12.2 opts=survive~:160:0:b3,survive~:225:0:b4,survive~:225:0:b4,hold:96:0,survive:96:0
10623 play=hold v=dies under=0 mat=17 land=102 dies=131 w3=-1 sooner=survive:196:k2.margin mgs=0.2.12.4,0.2.12.4,0.1.12.6 opts=hold:131:0,level:131:0,survive~:196:0:b4
10636 play=hold v=dies under=0 mat=17 land=89 dies=118 w3=-1 sooner=survive:183:k2.margin mgs=0.2.12.4,0.2.12.4,0.1.12.6,0.1.12.6 opts=hold:118:0,level:118:0,survive~:183:0:b4,survive~:183:0:b4
10649 play=hold v=dies under=0 mat=17 land=76 dies=105 w3=-1 sooner=survive:170:k2.margin mgs=0.2.12.4,0.1.12.6,0.1.12.6 opts=hold:105:0,survive~:170:0:b4,survive~:170:0:b4
10662 play=survive v=dies under=0 mat=17 land=63 dies=92 w3=0 mgs=0.1.12.6,0.1.12.6,0.2.12.4 opts=survive~:157:0:b4,survive~:157:0:b4,hold:92:0
10677 play=hold v=dies under=0 mat=14 land=102 dies=142 w3=-1 mgs=0.1.12.6,0.1.12.6,0.1.12.4 opts=hold:142:0,survive:142:0,level:142:0
10690 play=hold v=dies under=0 mat=14 land=89 dies=129 w3=-1 mgs=0.1.12.6,0.1.12.6,0.1.12.4 opts=hold:129:0,survive:129:0,level:129:0
10703 play=hold v=dies under=0 mat=14 land=76 dies=116 w3=-1 mgs=0.1.12.6,0.1.12.6,0.1.12.4 opts=hold:116:0,survive:116:0,level:116:0
10716 play=hold v=dies under=0 mat=14 land=63 dies=103 w3=-1 mgs=0.1.12.6,0.1.12.6 opts=hold:103:0,survive:103:0
10729 play=survive v=lives under=1 mat=11 land=50 dies=90 w3=0 mgs=0.1.12.4,2.1.12.0,0.1.12.6,2.1.12.0,0.1.12.4,0.1.12.6,0.1.12.6 opts=survive:L:0,toward:100:0,survive:95:0,toward:94:0,survive:92:0,hold:90:0,setup:90:0
10754 play=carry v=lives under=1 mat=11 land=25 dies=67 w3=0 mgs=0.1.12.4,2.1.12.4,2.1.12.4,2.1.12.4,2.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4 opts=carry*:L:0,toward:68:0,toward:68:0,toward:68:0,toward:67:0,level:72:0,hold:67:0,setup:67:0
10784 play=carry_wait v=dies under=1 mat=11 land=0 dies=37 w3=1/w mgs=0.8.12.6,0.8.12.6,0.8.12.6,4.1.12.4,0.1.12.4,4.1.12.4,4.1.12.4,4.1.12.4 opts=carry_wait*:451:44,carry:451:44,survive:446:44,clear:417:0,setup:41:0:e112,carry:40:0,survive:40:0,carry_wait:37:0
10797 play=carry v=dies under=1 mat=11 land=0 dies=24 w3=1/w mgs=0.8.12.6,0.8.12.6,0.8.12.6,0.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4 opts=carry*:438:44,survive:436:44,carry:426:44,clear:416:0,survive:29:0,level:28:0,hold:24:0,setup:24:0
10803 play=carry v=dies under=1 mat=11 land=0 dies=1 w3=1/w mgs=0.8.12.6,0.8.12.6,0.1.12.10,0.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4 opts=carry*:432:44,carry:426:44,survive~:81:0,toward:61:0,level:21:0,hold:18:0,setup:18:0,carry:18:0
10816 play=carry v=dies under=1 mat=11 land=42 dies=43 w3=0 mgs=0.8.12.6,0.1.12.10,0.1.12.4,0.1.12.4,0.1.12.4 opts=carry*:419:44,survive:68:0,toward:68:0,hold:48:0,level:48:0
10834 play=toward v=dies under=1 mat=11 land=24 dies=25 w3=0 mgs=0.1.12.4,0.1.12.10,0.1.12.4,0.1.12.4 opts=toward:58:0,survive:50:0,hold:30:0,level:30:0
10856 play=survive v=dies under=1 mat=11 land=2 dies=3 w3=0 mgs=0.1.12.10,0.1.12.4,0.1.12.4,0.1.12.4,0.1.12.4 opts=survive:36:0,toward:36:0,carry*:36:0,hold:8:0,level:8:0
10874 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10,0.1.12.10,0.1.12.10,0.1.12.10 opts=hold:18:0,toward:18:0,setup:18:0,level:18:0,level:18:0
10878 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.12,0.1.12.10,0.1.12.10 opts=hold:14:0,level:14:0,level:14:0
10880 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10,0.1.12.10 opts=hold:12:0,level:12:0,level:12:0
10881 play=level v=dies under=1 mat=8 land=0 dies=1 w3=0 mgs=0.1.12.10,0.1.12.10,0.1.12.10 opts=level:12:0,level:12:0,hold:11:0
10882 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10,0.1.12.10 opts=hold:10:0,level:10:0,carry*:10:0
10883 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10 opts=hold:9:0,level:9:0
10884 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10 opts=hold:8:0,level:8:0
10885 play=level v=dies under=1 mat=8 land=0 dies=1 w3=0 mgs=0.1.12.10,0.1.12.10 opts=level:8:0,hold:7:0
10886 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10 opts=hold:6:0
10887 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10,0.1.12.10 opts=hold:5:0,level:5:0,level:5:0
10888 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10 opts=hold:4:0,level:4:0
10889 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10 opts=hold:3:0,level:3:0
10890 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.0.10,0.1.0.10 opts=hold:2:0,level:2:0
10891 play=hold v=dies under=1 mat=8 land=0 dies=1 w3=-1 mgs=0.1.12.10,0.1.12.10,0.1.12.10 opts=hold:1:0,level:1:0,level:1:0
```

## combo_storm-7 round 2, lost at 14747

```
14347 play=entry v=dies under=1 mat=35 land=13 dies=14 w3=0 sooner=break_line:556:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=entry:446:4:b3,entry:446:4:b3,entry:369:4:b3,entry:369:4:b3,entry:369:4:b3,entry:369:4:b3,nearest:369:4:b3,carry*:369:4:b3
14366 play=carry v=dies under=1 mat=35 land=42 dies=43 w3=0 mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=carry:417:4,extend:367:4:b4,extend:367:4:b4,survive:367:4:b4,entry:325:4,break_line:325:4,entry:354:4,entry:354:4
14381 play=carry v=dies under=1 mat=35 land=27 dies=28 w3=0 mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=carry*:402:4,extend:352:4:b4,extend:352:4:b4,survive:352:4:b4,entry:310:4,break_line:310:4,entry:390:4,entry:390:4
14397 play=carry v=dies under=1 mat=35 land=11 dies=12 w3=0 sooner=entry:388:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.12,0.3.12.2 opts=carry*:386:4,extend:336:4:b4,extend:336:4:b4,extend:336:4:b4,extend:336:4:b4,survive:336:4:b4,survive:336:4:b4,break_line:294:4
14413 play=carry v=dies under=1 mat=32 land=152 dies=153 w3=0 sooner=break_line:624:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.5.12.4,0.3.12.4,0.3.12.4,0.3.12.4,0.3.12.4 opts=carry*:370:4,entry:348:4,entry:348:4,break_line:624:9,hold:206:0,clear:206:0,clear:206:0,clear:200:0:e205
14429 play=carry v=dies under=1 mat=32 land=136 dies=137 w3=0 sooner=entry:359:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.4,0.3.12.4,0.3.12.4,0.3.12.4 opts=carry*:354:4,entry:332:4,entry:359:4:b1,entry:358:4:b1,hold:190:0,clear:190:0,clear:190:0,clear:190:0
14445 play=carry v=dies under=1 mat=32 land=120 dies=121 w3=0 sooner=break_line:592:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.5.12.4,0.3.12.4 opts=carry*:338:4,entry:316:4,entry:355:4:b1,entry:355:4:b1,entry:343:4:b1,entry:342:4:b1,break_line:592:9,hold:174:0
14461 play=carry v=dies under=1 mat=32 land=104 dies=105 w3=0 sooner=entry:343:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.4,0.3.12.4 opts=carry*:322:4,entry:343:4,entry:300:4,entry:339:4:b1,entry:327:4:b1,entry:327:4:b1,hold:158:0,clear:158:0
14477 play=carry v=dies under=1 mat=32 land=88 dies=89 w3=0 sooner=entry:327:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.4 opts=carry*:306:4,entry:327:4,entry:293:4:b1,entry:293:4:b1,entry:293:4:b1,entry:293:4:b1,nearest:293:4:b1,hold:142:0
14493 play=hold v=dies under=1 mat=25 land=126 dies=126 w3=-1 sooner=entry:311:k2.margin mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=hold:126:0,level:63:0:e125,level:63:0:e125,setup:126:0,entry:311:4:b1,entry:277:4:b1,entry:231:4:b1,entry:231:4:b1
14509 play=hold v=dies under=1 mat=25 land=110 dies=110 w3=-1 sooner=entry:295:k2.margin mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.4,0.3.12.2,0.3.12.2,0.3.12.2 opts=hold:110:0,setup:110:0,level:47:0:e109,level:47:0:e109,setup:134:0,entry:295:4:b1,entry:216:4:b1,entry:216:4:b1
14525 play=entry v=dies under=1 mat=25 land=94 dies=94 w3=0 sooner=entry:279:k4.list mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2 opts=entry:200:4:b1,entry:200:4:b1,entry:200:4:b1,entry:200:4:b1,nearest:200:4:b1,break_search:184:4:b1,break_line:191:4:b1,survive:204:4:b1
14541 play=carry v=dies under=1 mat=22 land=78 dies=78 w3=0 sooner=survive:251:k5.value mgs=0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.2,0.3.12.12,0.3.12.12 opts=carry:184:4:b1,survive:251:4:b1,break_search:188:4:b1,break_search:150:4,hold:78:0,setup:78:0
14587 play=hold v=dies under=1 mat=22 land=138 dies=138 w3=-1 mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.4 opts=hold:138:0,level:138:0,survive:138:0,toward:138:0
14600 play=hold v=dies under=1 mat=22 land=125 dies=125 w3=-1 sooner=toward:143:k5.value mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.4 opts=hold:125:0,level:125:0,survive:125:0,toward:143:0
14613 play=hold v=dies under=1 mat=22 land=112 dies=112 w3=-1 mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.4 opts=hold:112:0,level:112:0,survive:112:0,toward:112:0
14626 play=hold v=dies under=1 mat=22 land=99 dies=99 w3=-1 mgs=0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12 opts=hold:99:0,level:99:0,survive:99:0,toward:99:0
14639 play=survive v=dies under=1 mat=22 land=86 dies=86 w3=0 mgs=0.3.12.10,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.4 opts=survive:109:0,hold:86:0,level:86:0,level:86:0,toward:86:0
14662 play=carry v=dies under=1 mat=16 land=63 dies=63 w3=0 mgs=0.3.12.10,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12 opts=carry*:86:0,setup:63:0:e69,hold:63:0,level:63:0,survive:63:0,setup:63:0
14674 play=toward v=dies under=1 mat=20 land=51 dies=51 w3=0 mgs=3.3.12.2,0.3.12.10,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12,0.3.12.12 opts=toward:74:0,carry*:74:0,hold:51:0,level:51:0,level:51:0,survive:51:0,setup:51:0,setup:51:0
14694 play=level v=dies under=1 mat=20 land=31 dies=31 w3=0 mgs=0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.12,0.3.12.12,0.3.12.2,0.3.12.2 opts=level:54:0,survive:54:0,setup:54:0,hold:31:0,setup:31:0,toward:54:0,carry*:54:0
14707 play=level v=dies under=1 mat=20 land=18 dies=18 w3=0 mgs=0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.12,0.3.12.2,0.3.12.2 opts=level:41:0,carry*:41:0,survive:41:0,setup:41:0,hold:18:0,toward:41:0,setup:18:0
14720 play=level v=dies under=1 mat=20 land=5 dies=5 w3=0 mgs=0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.10,0.3.12.2,0.3.12.2 opts=level:28:0,setup:28:0,carry*:28:0,survive:28:0,setup:28:0,toward:28:0,hold:5:0
14733 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10,0.3.12.10,0.3.12.10 opts=hold:15:0,toward:15:0,setup:15:0
14734 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.12,0.3.12.10,0.3.12.10 opts=hold:14:0,toward:14:0,setup:14:0
14736 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:12:0
14737 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:11:0
14738 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:10:0
14739 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:9:0
14740 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:8:0
14741 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:7:0
14742 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:6:0
14743 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:5:0
14744 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:4:0
14745 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:3:0
14746 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:2:0
14747 play=hold v=dies under=1 mat=20 land=0 dies=1 w3=-1 mgs=0.3.12.10 opts=hold:1:0
```

