"""Fast, conservative classification for new tasks with no explicit scope."""
import re

from .schemas import TaskFields

TERMS = {
    'life': (
        '生活 家务 买菜 买牛奶 购物 超市 做饭 做菜 洗碗 打扫 整理房间 洗衣 晾衣 '
        '收拾房间 扔垃圾 倒垃圾 快递 取件 房租 水电费 缴费 还款 体检 看病 挂号 '
        '医院 健身 锻炼 运动 跑步 散步 游泳 瑜伽 旅行 旅游 订机票 订酒店 聚餐 买东西 '
        '看电影 陪家人 接孩子 遛狗 喂猫 喂狗 生日 理发 搬家 修车 保养汽车'
    ).split(),
    'study': (
        '学习 复习 预习 备考 考试 考研 考公 作业 课程 上课 听课 网课 读书 '
        '背书 看书 阅读 阅读书籍 阅读计划 读书笔记 学习笔记 课程笔记 单词 背诵 练习题 '
        '刷题 做题 错题 英语 数学 语文 物理 化学 历史课 地理课 论文 学术 '
        '教材 知识点 讲义 雅思 托福 资格证 驾考 学车 自学'
    ).split(),
    'work': (
        '工作 上班 开会 会议 客户 项目 需求 产品评审 项目评审 汇报 报告 周报 '
        '月报 方案 合同 发票 报销 财务 同事 老板 公司 办公 业务 销售 营销 '
        '招聘 面试 交付 发布上线 部署 修复bug 修复缺陷 写代码 编写代码 '
        '开发功能 测试功能 整理资料 评审资料 工作邮件'
    ).split(),
}
ENGLISH_TERMS = {
    'life': 'grocery groceries shopping rent workout jogging laundry housework vacation',
    'study': 'study studying revise revision homework exam course lesson vocabulary textbook',
    'work': 'work meeting client project report invoice contract deploy deployment bugfix',
}
PATTERNS = {
    scope: re.compile('|'.join(map(re.escape, sorted(words, key=len, reverse=True)))
        + r'|\b(?:' + '|'.join(ENGLISH_TERMS[scope].split()) + r')\b', re.IGNORECASE)
    for scope, words in TERMS.items()
}


def scores(text: str) -> dict[str, int]:
    return {scope: sum(min(4, len(match.group())) for match in pattern.finditer(text))
            for scope, pattern in PATTERNS.items()}


def infer_scope(title: str, notes: str = '') -> str:
    primary, secondary = scores(title), scores(notes)
    # A clear title wins over incidental background in the notes. Notes break ties
    # or supply evidence when the title contains no category clues.
    ranking = {scope: (primary[scope], secondary[scope]) for scope in TERMS}
    best = max(ranking.values())
    winners = [scope for scope, score in ranking.items() if score == best]
    return winners[0] if best != (0, 0) and len(winners) == 1 else 'unassigned'


def with_inferred_scope(body: TaskFields) -> TaskFields:
    if 'scope' in body.model_fields_set:
        return body
    return body.model_copy(update={'scope': infer_scope(body.title, body.notes)})
