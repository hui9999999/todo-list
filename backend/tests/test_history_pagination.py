def test_history_pagination_reaches_records_beyond_twenty_and_is_private(accounts):
    owner, other = accounts(), accounts()
    for index in range(23):
        result = owner.post('/api/v1/tasks', json={'title': f'分页项目 {index + 1}', 'scope': 'study'})
        assert result.status_code == 201, result.text
    other.post('/api/v1/tasks', json={'title': '其他账户分页项目', 'scope': 'study'})
    pages = [owner.get('/api/v1/history/search', params={
        'q': '分页项目', 'scope': 'study', 'semantic': 'false', 'page': page, 'page_size': 10,
    }).json() for page in (1, 2, 3)]
    assert [len(page['hits']) for page in pages] == [10, 10, 3]
    assert all(page['total'] == 23 for page in pages)
    assert [page['page'] for page in pages] == [1, 2, 3]
    assert all(page['page_size'] == 10 for page in pages)
    identifiers = [hit['event_id'] for page in pages for hit in page['hits']]
    assert len(set(identifiers)) == 23
    assert all(hit['title'] != '其他账户分页项目' for page in pages for hit in page['hits'])
    repeat = owner.get('/api/v1/history/search', params={'q': '分页项目', 'scope': 'study', 'semantic': 'false', 'page': 2, 'page_size': 10}).json()
    assert repeat['hits'] == pages[1]['hits']
    assert len(owner.get('/api/v1/history/search').json()['hits']) == 20
    assert owner.get('/api/v1/history/search?page=4&page_size=10').json()['hits'] == []
    for params in ({'page': 0}, {'page_size': 0}, {'page_size': 51}):
        assert owner.get('/api/v1/history/search', params=params).status_code == 422
