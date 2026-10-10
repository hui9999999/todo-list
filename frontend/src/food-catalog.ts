import {foodImageAssets} from './food-image-assets';

export type Meal = 'breakfast' | 'lunch' | 'dinner';
export type FoodGroup = 'breakfast' | 'vegetables' | 'meat' | 'seafood' | 'eggs-tofu' | 'soups';
export interface Food { id: string; name: string; note: string; category: 'breakfast' | 'main'; group: FoodGroup; image: string; thumbnail: string }
function imagesForFood(id: string) {
  const assets=foodImageAssets[id];
  if(!assets)throw new Error('菜品图片资源缺失：'+id);
  return assets;
}
export const foodGroups: {id: FoodGroup; name: string}[] = [
  {id:'breakfast',name:'早餐'},
  {id:'vegetables',name:'蔬菜'},
  {id:'meat',name:'肉类'},
  {id:'seafood',name:'鱼虾'},
  {id:'eggs-tofu',name:'蛋与豆制品'},
  {id:'soups',name:'汤类'},
];
export const meals: {id: Meal; name: string; caption: string}[] = [
  {id:'breakfast', name:'早餐', caption:'给一天一个暖暖的开始'},
  {id:'lunch', name:'午餐', caption:'忙到中午，也记得好好吃饭'},
  {id:'dinner', name:'晚餐', caption:'用一顿家常饭收尾'},
];
export const foods: Food[] = [
  {id:'baozi',name:'包子',note:'热气腾腾，松软有馅',group:'breakfast',category:'breakfast'},
  {id:'mantou',name:'馒头',note:'朴素的麦香，松软可口',group:'breakfast',category:'breakfast'},
  {id:'jiaozi',name:'饺子',note:'一口一个，暖胃又满足',group:'breakfast',category:'breakfast'},
  {id:'noodles',name:'面条',note:'一碗热汤面，慢慢吃',group:'breakfast',category:'breakfast'},
  {id:'congee',name:'粥',note:'温热绵密的家常白粥',group:'breakfast',category:'breakfast'},
  {id:'shouzhua',name:'手抓饼',note:'金黄酥香，层层松脆',group:'breakfast',category:'breakfast'},
  {id:'jianbing',name:'煎饼果子',note:'蛋香和薄脆，熟悉的街头味道',group:'breakfast',category:'breakfast'},
  {id:'roujiamo',name:'肉夹馍',note:'酥香饼皮，夹一口软烂肉',group:'breakfast',category:'breakfast'},
  {id:'youtiao',name:'油条',note:'金黄蓬松，熟悉的早点',group:'breakfast',category:'breakfast'},
  {id:'soy-milk',name:'豆浆',note:'温热豆香，简单一杯',group:'breakfast',category:'breakfast'},
  {id:'shaomai',name:'烧麦',note:'糯米和肉香，饱满一口',group:'breakfast',category:'breakfast'},
  {id:'xiaolongbao',name:'小笼包',note:'薄皮多汁，一笼热乎',group:'breakfast',category:'breakfast'},
  {id:'wonton',name:'馄饨',note:'薄皮鲜馅，热汤暖胃',group:'breakfast',category:'breakfast'},
  {id:'rice-roll',name:'肠粉',note:'米皮滑嫩，酱香清爽',group:'breakfast',category:'breakfast'},
  {id:'egg-pancake',name:'鸡蛋饼',note:'柔软蛋香，快手早餐',group:'breakfast',category:'breakfast'},
  {id:'scallion-pancake',name:'葱油饼',note:'外酥内软，葱香四溢',group:'breakfast',category:'breakfast'},
  {id:'tangyuan',name:'汤圆',note:'软糯圆润，甜甜一碗',group:'breakfast',category:'breakfast'},
  {id:'changsha-rice-noodles',name:'长沙米粉',note:'米粉柔滑，肉丝汤鲜',group:'breakfast',category:'breakfast'},
  {id:'changde-beef-rice-noodles',name:'常德牛肉粉',note:'圆粉爽滑，牛肉浓香',group:'breakfast',category:'breakfast'},
  {id:'hot-sour-glass-noodles',name:'酸辣粉',note:'粉条爽滑，酸辣开胃',group:'breakfast',category:'breakfast'},
  {id:'reganmian',name:'热干面',note:'芝麻酱香，面条筋道',group:'breakfast',category:'breakfast'},
  {id:'shengjianbao',name:'生煎包',note:'底部酥脆，肉馅多汁',group:'breakfast',category:'breakfast'},
  {id:'potstickers',name:'锅贴',note:'煎底金黄，馅香皮脆',group:'breakfast',category:'breakfast'},
  {id:'sticky-rice-roll',name:'糯米饭团',note:'糯米软糯，馅料咸香',group:'breakfast',category:'breakfast'},
  {id:'ciba',name:'糍粑',note:'外香内糯，米香浓郁',group:'breakfast',category:'breakfast'},
  {id:'tofu-pudding',name:'豆腐脑',note:'豆花滑嫩，热卤鲜香',group:'breakfast',category:'breakfast'},
  {id:'hulatang',name:'胡辣汤',note:'汤汁浓厚，胡椒暖香',group:'breakfast',category:'breakfast'},
  {id:'pumpkin-millet-porridge',name:'小米南瓜粥',note:'小米绵密，南瓜清甜',group:'breakfast',category:'breakfast'},
  {id:'century-egg-pork-congee',name:'皮蛋瘦肉粥',note:'粥底绵滑，皮蛋肉香',group:'breakfast',category:'breakfast'},
  {id:'eight-treasure-congee',name:'八宝粥',note:'杂粮软糯，香甜暖胃',group:'breakfast',category:'breakfast'},
  {id:'tea-eggs',name:'茶叶蛋',note:'茶香入味，蛋白细嫩',group:'breakfast',category:'breakfast'},
  {id:'steamed-corn',name:'蒸玉米',note:'颗粒饱满，玉米清甜',group:'breakfast',category:'breakfast'},
  {id:'roasted-sweet-potato',name:'烤红薯',note:'薯肉绵软，自然香甜',group:'breakfast',category:'breakfast'},
  {id:'whole-wheat-sandwich',name:'全麦三明治',note:'麦香扎实，蛋蔬清爽',group:'breakfast',category:'breakfast'},
  {id:'milk-oatmeal',name:'牛奶燕麦',note:'燕麦柔软，奶香温润',group:'breakfast',category:'breakfast'},
  {id:'yogurt-fruit-bowl',name:'酸奶水果碗',note:'酸奶细滑，水果清新',group:'breakfast',category:'breakfast'},
  {id:'steamed-rice-cake',name:'蒸发糕',note:'糕体蓬松，米香微甜',group:'breakfast',category:'breakfast'},
  {id:'pepper-pork',name:'辣椒炒肉',note:'鲜辣开胃，配一碗米饭',group:'meat',category:'main'},
  {id:'tomato-egg',name:'番茄炒蛋',note:'酸甜番茄，蓬松鸡蛋',group:'eggs-tofu',category:'main'},
  {id:'potato-strips',name:'土豆丝',note:'清爽脆口的家常小炒',group:'vegetables',category:'main'},
  {id:'kung-pao',name:'宫保鸡丁',note:'鸡丁、花生和一口酱香',group:'meat',category:'main'},
  {id:'mapo-tofu',name:'麻婆豆腐',note:'麻辣鲜香，豆腐软嫩',group:'eggs-tofu',category:'main'},
  {id:'braised-pork',name:'红烧肉',note:'色泽红亮，软糯酱香',group:'meat',category:'main'},
  {id:'sweet-sour-pork',name:'糖醋里脊',note:'外酥内嫩，酸甜开胃',group:'meat',category:'main'},
  {id:'fish-fragrant-pork',name:'鱼香肉丝',note:'肉丝配蔬菜，酸辣酱香',group:'meat',category:'main'},
  {id:'twice-cooked-pork',name:'回锅肉',note:'薄片肉香，鲜辣下饭',group:'meat',category:'main'},
  {id:'pepper-pork-strips',name:'青椒肉丝',note:'青椒清香，肉丝鲜嫩',group:'meat',category:'main'},
  {id:'braised-ribs',name:'红烧排骨',note:'酱香入味，家常一盘',group:'meat',category:'main'},
  {id:'sweet-sour-ribs',name:'糖醋排骨',note:'酸甜挂汁，肉香浓郁',group:'meat',category:'main'},
  {id:'potato-beef',name:'土豆炖牛肉',note:'软烂牛肉，绵软土豆',group:'meat',category:'main'},
  {id:'tomato-brisket',name:'番茄牛腩',note:'浓浓番茄，牛腩软嫩',group:'meat',category:'main'},
  {id:'onion-beef',name:'洋葱炒牛肉',note:'洋葱微甜，牛肉鲜香',group:'meat',category:'main'},
  {id:'braised-chicken',name:'黄焖鸡',note:'鸡肉软嫩，浓汁拌饭',group:'meat',category:'main'},
  {id:'three-cup-chicken',name:'三杯鸡',note:'浓郁酱香，九层塔清香',group:'meat',category:'main'},
  {id:'cola-wings',name:'可乐鸡翅',note:'甜咸酱汁，鸡翅油亮',group:'meat',category:'main'},
  {id:'mushroom-chicken',name:'香菇炖鸡',note:'鲜香菇香，鸡肉软嫩',group:'meat',category:'main'},
  {id:'braised-fish',name:'红烧鱼',note:'浓汁鲜香，家常鱼味',group:'seafood',category:'main'},
  {id:'sweet-sour-fish',name:'糖醋鱼',note:'鱼肉酥香，酸甜浓汁',group:'seafood',category:'main'},
  {id:'garlic-shrimp',name:'蒜蓉虾',note:'蒜香鲜甜，虾肉弹嫩',group:'seafood',category:'main'},
  {id:'braised-shrimp',name:'油焖大虾',note:'鲜虾油亮，浓香入味',group:'seafood',category:'main'},
  {id:'garlic-broccoli',name:'蒜蓉西兰花',note:'翠绿清爽，淡淡蒜香',group:'vegetables',category:'main'},
  {id:'torn-cabbage',name:'手撕包菜',note:'脆嫩包菜，鲜香一炒',group:'vegetables',category:'main'},
  {id:'vinegar-cabbage',name:'醋溜白菜',note:'白菜清脆，酸香开胃',group:'vegetables',category:'main'},
  {id:'eggplant-beans',name:'豆角烧茄子',note:'豆角和茄子，软嫩酱香',group:'vegetables',category:'main'},
  {id:'fish-fragrant-eggplant',name:'鱼香茄子',note:'茄子软糯，酸辣入味',group:'vegetables',category:'main'},
  {id:'di-san-xian',name:'地三鲜',note:'土豆茄子青椒，鲜香下饭',group:'vegetables',category:'main'},
  {id:'dry-fried-beans',name:'干煸四季豆',note:'豆角微皱，干香爽口',group:'vegetables',category:'main'},
  {id:'moo-shu-pork',name:'木须肉',note:'鸡蛋肉片，木耳脆香',group:'meat',category:'main'},
  {id:'home-style-tofu',name:'家常豆腐',note:'豆腐煎香，家常滋味',group:'eggs-tofu',category:'main'},
  {id:'steamed-eggs',name:'蒸蛋',note:'细腻滑嫩，温柔蛋香',group:'eggs-tofu',category:'main'},
  {id:'winter-melon-ribs',name:'冬瓜排骨汤',note:'冬瓜清甜，排骨汤鲜',group:'soups',category:'main'},
  {id:'pepper-cured-pork',name:'辣椒炒腊肉',note:'青椒鲜辣，腊肉咸香',group:'meat',category:'main'},
  {id:'pepper-egg',name:'辣椒炒蛋',note:'青椒清香，鸡蛋蓬松',group:'eggs-tofu',category:'main'},
  {id:'pepper-small-fish',name:'辣椒炒小鱼',note:'小鱼干香，辣椒开胃',group:'seafood',category:'main'},
  {id:'ham-egg',name:'火腿炒蛋',note:'火腿咸香，鸡蛋软嫩',group:'eggs-tofu',category:'main'},
  {id:'salt-baked-chicken',name:'盐焗鸡',note:'鸡皮金黄，咸香鲜嫩',group:'meat',category:'main'},
  {id:'steamed-sea-bass',name:'清蒸鲈鱼',note:'鲈鱼鲜嫩，姜葱提香',group:'seafood',category:'main'},
  {id:'flash-fried-beef',name:'爆炒牛肉',note:'大火快炒，牛肉鲜辣',group:'meat',category:'main'},
  {id:'tofu-puffs-pork',name:'油豆腐炒肉',note:'豆腐吸汁，肉片鲜香',group:'eggs-tofu',category:'main'},
  {id:'tofu-puffs-cured-pork',name:'油豆腐炒腊肉',note:'豆腐酱香，腊肉浓郁',group:'eggs-tofu',category:'main'},
  {id:'bean-curd-skin-pork',name:'腐竹炒肉',note:'腐竹柔韧，肉片入味',group:'eggs-tofu',category:'main'},
  {id:'stir-fried-napa-cabbage',name:'清炒白菜',note:'白菜清甜，脆嫩爽口',group:'vegetables',category:'main'},
  {id:'stir-fried-bitter-melon',name:'清炒苦瓜',note:'苦瓜清脆，清爽回甘',group:'vegetables',category:'main'},
  {id:'chopped-chili-fish-head',name:'剁椒鱼头',note:'剁椒鲜辣，鱼头鲜嫩',group:'seafood',category:'main'},
  {id:'dongan-chicken',name:'东安鸡',note:'酸辣鲜香，鸡肉爽嫩',group:'meat',category:'main'},
  {id:'steamed-cured-meats',name:'腊味合蒸',note:'腊肉腊肠，合蒸浓香',group:'meat',category:'main'},
  {id:'yongzhou-blood-duck',name:'永州血鸭',note:'鸭肉浓香，鲜辣入味',group:'meat',category:'main'},
  {id:'hunan-spicy-crayfish',name:'口味虾',note:'虾肉鲜甜，香辣浓郁',group:'seafood',category:'main'},
  {id:'mashed-pepper-century-egg',name:'擂辣椒皮蛋',note:'辣椒焦香，皮蛋醇厚',group:'eggs-tofu',category:'main'},
  {id:'blistered-green-peppers',name:'虎皮青椒',note:'青椒起皱，酱香开胃',group:'vegetables',category:'main'},
  {id:'sour-beans-minced-pork',name:'酸豆角炒肉末',note:'酸豆角爽脆，肉末鲜香',group:'meat',category:'main'},
  {id:'xiangxi-grandmas-vegetables',name:'湘西外婆菜',note:'腌菜咸香，家常下饭',group:'vegetables',category:'main'},
  {id:'garlic-shoots-cured-pork',name:'蒜苗炒腊肉',note:'蒜苗清香，腊肉醇香',group:'meat',category:'main'},
  {id:'dry-pot-cauliflower',name:'干锅花菜',note:'花菜脆嫩，干香微辣',group:'vegetables',category:'main'},
  {id:'hunan-mixed-pork-egg',name:'农家一碗香',note:'肉片蛋香，鲜辣下饭',group:'meat',category:'main'},
  {id:'firm-tofu-pork',name:'香干炒肉',note:'香干紧实，肉丝鲜香',group:'eggs-tofu',category:'main'},
  {id:'chives-river-shrimp',name:'韭菜炒河虾',note:'韭菜清香，小虾鲜甜',group:'seafood',category:'main'},
  {id:'dried-radish-cured-pork',name:'萝卜干炒腊肉',note:'萝卜干脆，腊肉咸香',group:'meat',category:'main'},
  {id:'chopped-chili-taro',name:'剁椒蒸芋头',note:'芋头绵软，剁椒鲜香',group:'vegetables',category:'main'},
  {id:'hot-sour-lotus-root',name:'酸辣藕丁',note:'藕丁脆爽，酸辣开胃',group:'vegetables',category:'main'},
  {id:'white-chili-pork',name:'白辣椒炒肉',note:'白辣椒酸香，肉片鲜嫩',group:'meat',category:'main'},
  {id:'dry-pot-pork-intestine',name:'干锅肥肠',note:'肥肠软韧，香辣浓郁',group:'meat',category:'main'},
  {id:'changsha-stinky-tofu',name:'长沙臭豆腐',note:'外脆里嫩，香辣多汁',group:'eggs-tofu',category:'main'},
  {id:'garlic-youmai',name:'蒜蓉油麦菜',note:'叶片脆嫩，蒜香清爽',group:'vegetables',category:'main'},
  {id:'garlic-water-spinach',name:'蒜蓉空心菜',note:'菜梗爽脆，蒜香鲜嫩',group:'vegetables',category:'main'},
  {id:'garlic-lettuce',name:'蒜蓉生菜',note:'生菜柔嫩，清甜蒜香',group:'vegetables',category:'main'},
  {id:'stir-fried-spinach',name:'清炒菠菜',note:'叶嫩梗软，清香可口',group:'vegetables',category:'main'},
  {id:'stir-fried-amaranth',name:'清炒苋菜',note:'苋菜细嫩，鲜香清爽',group:'vegetables',category:'main'},
  {id:'garlic-choy-sum',name:'蒜蓉菜心',note:'菜心脆嫩，蒜香清甜',group:'vegetables',category:'main'},
  {id:'stir-fried-gai-lan',name:'清炒芥蓝',note:'芥蓝爽脆，清香回甘',group:'vegetables',category:'main'},
  {id:'stir-fried-celtuce',name:'清炒莴笋',note:'莴笋清脆，淡淡清甜',group:'vegetables',category:'main'},
  {id:'stir-fried-luffa',name:'清炒丝瓜',note:'丝瓜软嫩，鲜甜多汁',group:'vegetables',category:'main'},
  {id:'stir-fried-zucchini',name:'清炒西葫芦',note:'瓜片脆嫩，清爽家常',group:'vegetables',category:'main'},
  {id:'stir-fried-pumpkin',name:'清炒南瓜',note:'南瓜绵软，自然香甜',group:'vegetables',category:'main'},
  {id:'stir-fried-winter-melon',name:'清炒冬瓜',note:'冬瓜清甜，软嫩爽口',group:'vegetables',category:'main'},
  {id:'garlic-snow-peas',name:'蒜蓉荷兰豆',note:'豆荚清脆，蒜香鲜甜',group:'vegetables',category:'main'},
  {id:'celery-firm-tofu',name:'芹菜炒香干',note:'芹菜爽脆，香干鲜香',group:'eggs-tofu',category:'main'},
  {id:'stir-fried-lotus-root',name:'清炒莲藕',note:'藕片脆爽，清香微甜',group:'vegetables',category:'main'},
  {id:'stir-fried-chinese-yam',name:'清炒山药',note:'山药脆嫩，清淡顺口',group:'vegetables',category:'main'},
  {id:'cucumber-wood-ear',name:'木耳炒黄瓜',note:'黄瓜清脆，木耳爽滑',group:'vegetables',category:'main'},
  {id:'garlic-king-oyster-mushrooms',name:'蒜香杏鲍菇',note:'菌菇鲜香，柔韧多汁',group:'vegetables',category:'main'},
  {id:'stir-fried-water-bamboo',name:'清炒茭白',note:'茭白鲜嫩，清香微甜',group:'vegetables',category:'main'},
  {id:'tomato-cauliflower',name:'番茄烧花菜',note:'番茄酸甜，花菜鲜嫩',group:'vegetables',category:'main'},
  {id:'seaweed-egg-soup',name:'紫菜蛋花汤',note:'紫菜鲜香，蛋花轻柔',group:'soups',category:'main'},
  {id:'tomato-egg-soup',name:'番茄蛋花汤',note:'番茄酸甜，蛋花鲜嫩',group:'soups',category:'main'},
  {id:'mushroom-tofu-soup',name:'菌菇豆腐汤',note:'菌菇鲜香，豆腐软嫩',group:'soups',category:'main'},
  {id:'luffa-egg-soup',name:'丝瓜蛋汤',note:'丝瓜清甜，蛋香温润',group:'soups',category:'main'},
  {id:'spinach-pork-liver-soup',name:'菠菜猪肝汤',note:'菠菜清香，猪肝细嫩',group:'soups',category:'main'},
  {id:'corn-rib-soup',name:'玉米排骨汤',note:'玉米清甜，排骨汤鲜',group:'soups',category:'main'},
  {id:'lotus-root-rib-soup',name:'莲藕排骨汤',note:'莲藕粉糯，汤汁鲜香',group:'soups',category:'main'},
  {id:'radish-beef-soup',name:'萝卜牛肉汤',note:'萝卜清甜，牛肉醇香',group:'soups',category:'main'},
  {id:'winter-melon-shrimp-soup',name:'冬瓜虾仁汤',note:'冬瓜软嫩，虾仁鲜甜',group:'soups',category:'main'},
  {id:'kelp-tofu-soup',name:'海带豆腐汤',note:'海带清鲜，豆腐滑嫩',group:'soups',category:'main'},
  {id:'yam-chicken-soup',name:'山药鸡汤',note:'山药绵软，鸡汤清鲜',group:'soups',category:'main'},
  {id:'crucian-carp-tofu-soup',name:'鲫鱼豆腐汤',note:'鱼汤鲜醇，豆腐细嫩',group:'soups',category:'main'},
].map(food=>({...food, category:food.category as Food['category'], group:food.group as FoodGroup, ...imagesForFood(food.id)}));
// Keep retired dishes readable in saved menus without offering them as new choices.
export const retiredFoods: Food[] = [
  {id:'steamed-fish',name:'清蒸鱼',note:'鱼肉鲜嫩，姜葱提香',group:'seafood',category:'main',...imagesForFood('steamed-fish')},
];
const rememberedFoods=[...foods,...retiredFoods];
export const choiceKey = (date: string, meal: Meal) => `food:choice:${date}:${meal}`;
export function choiceContent(date: string, meal: Meal, food: Food | Food[]) {
  const selected=Array.isArray(food)?food:[food];
  const names=selected.length?selected.map(item=>`「${item.name}」`).join('、'):'（菜单已清空）';
  return `${date} 的${meals.find(item=>item.id===meal)!.name}确认选择了${names}。这是本次用餐计划，不代表已经吃过或长期喜好。`;
}
export function readChoices(date:string,meal:Meal,content:string):Food[] {
  const category=meal==='breakfast'?'breakfast':'main';
  const names=[...content.matchAll(/「([^」]+)」/g)].map(match=>match[1]);
  const selected=names.map(name=>rememberedFoods.find(food=>food.name===name && food.category===category));
  if(selected.some(food=>!food))return [];
  const found=selected as Food[];
  if(content!==choiceContent(date,meal,found))return [];
  return found.filter((food,index)=>found.findIndex(item=>item.id===food.id)===index);
}
export function pickFood(meal: Meal, exclude: string[] = []): Food {
  const pool = foods.filter(food=>food.category===(meal==='breakfast'?'breakfast':'main'));
  const available = pool.filter(food=>!exclude.includes(food.id));
  const choices = available.length ? available : pool;
  return choices[Math.floor(Math.random()*choices.length)]!;
}

