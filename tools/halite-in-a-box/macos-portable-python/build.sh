if [[ ! -d venv ]]; then
    virtualenv -p python3 venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

python setup.py py2app
cd dist/
zip -r ../python-macos.zip python-macos.app
